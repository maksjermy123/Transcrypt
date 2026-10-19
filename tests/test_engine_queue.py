# -*- coding: utf-8 -*-
"""Регрессионные тесты видимости очереди задач движка (Task 50).

Баг: задача, запущенная в одной вкладке, занимала движок, а остальные вкладки
видели только безликое «Движок занят другой задачей» — виновника (какая
вкладка, какой файл, сколько идёт) найти было негде.

Фиксы, которые проверяем:
  1. _job_snapshot отдаёт started_at — по нему сайт считает «идёт N мин».
  2. _running_jobs_summary описывает блокирующую задачу (тип, файл, минуты).
  3. run_job при ожидании слота пишет в лог задачи ИМЯ блокирующей.
  4. Записи без created_at не роняют сортировку журнала (/api/jobs).

Запускается и через unittest (так делает CI), и через pytest.
"""
import sys
import threading
import time
import types
import unittest

# ─── Заглушки тяжёлых ML-модулей ──────────────────────────────────────────────
# engine_server импортирует src.core.engine (torch + whisper) при импорте.
# Тестовая среда не тянет 2 ГБ весов ради проверки логики очереди — ставим
# минимальные фейки в sys.modules ДО импорта engine_server.
for _name in ("torch", "whisper", "deep_translator"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda item: types.SimpleNamespace()  # любые атрибуты
        sys.modules[_name] = _stub

import tempfile
import os

import engine_server as es


class EngineQueueTestBase(unittest.TestCase):
    """База: изоляция глобального состояния движка.

    ВАЖНО: JOBS_FILE переносится в tmp_path, иначе _save_jobs (его вызывает
    run_job) записал бы тестовые задачи в РЕАЛЬНЫЙ журнал пользователя
    ~/.local/share/VoxPaperAi/web_output/jobs.json — уже случалось: записи
    без created_at из теста роняли сортировку /api/jobs на живом движке.
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_jobs_file = es.JOBS_FILE
        self._old_jobs = dict(es.JOBS)
        self._patches = []  # (объект, имя атрибута, старое значение)
        es.JOBS_FILE = os.path.join(self._tmp.name, "jobs.json")
        es.JOBS.clear()

    def tearDown(self):
        es.JOBS_FILE = self._old_jobs_file
        es.JOBS.clear()
        es.JOBS.update(self._old_jobs)
        for obj, name, old in reversed(self._patches):
            setattr(obj, name, old)
        self._tmp.cleanup()

    def patch(self, obj, name, value):
        """Аналог monkeypatch.setattr для unittest."""
        self._patches.append((obj, name, getattr(obj, name)))
        setattr(obj, name, value)


class TestJobSnapshot(EngineQueueTestBase):
    def test_snapshot_has_started_at(self):
        now = time.time()
        job = {
            "id": "snap1",
            "type": "convert",
            "status": "running",
            "lane": "heavy",
            "label": "видео.mp4",
            "created_at": now - 10,
            "started_at": now - 5,
        }
        snap = es._job_snapshot(job)
        self.assertEqual(snap["started_at"], now - 5)
        # обратная совместимость: старые поля на месте
        self.assertEqual(snap["job_id"], "snap1")
        self.assertEqual(snap["type"], "convert")
        self.assertEqual(snap["label"], "видео.mp4")

    def test_started_at_survives_save_load_roundtrip(self):
        """started_at сохраняется в jobs.json и восстанавливается после перезапуска."""
        now = time.time()
        es.JOBS["s1"] = {
            "id": "s1", "type": "transcribe", "status": "running", "lane": "heavy",
            "label": "лекция.mp3", "created_at": now - 100, "started_at": now - 90,
            "finished_at": None,
        }
        es._save_jobs()
        es.JOBS.clear()
        es._load_jobs()
        snap = es._job_snapshot(es.JOBS["s1"])
        # незавершённая после «перезапуска» помечается ошибкой, но started_at остаётся
        self.assertEqual(snap["status"], "error")
        self.assertEqual(snap["started_at"], now - 90)


class TestRunningJobsSummary(EngineQueueTestBase):
    def test_names_blocker(self):
        now = time.time()
        es.JOBS["b1"] = {
            "id": "b1", "type": "convert", "status": "running", "lane": "heavy",
            "label": "Уборщик ЗАРУБИЛСЯ.mp4", "started_at": now - 130,
        }
        s = es._running_jobs_summary("heavy")
        self.assertIn("Конвертация", s)
        self.assertIn("Уборщик ЗАРУБИЛСЯ.mp4", s)
        self.assertIn("идёт 2 мин", s)
        # другая полоса свободна
        self.assertEqual(es._running_jobs_summary("light"), "")

    def test_empty_when_idle(self):
        self.assertEqual(es._running_jobs_summary("heavy"), "")


class TestRunJobQueueMessage(EngineQueueTestBase):
    def test_queue_message_names_blocker(self):
        """Занятая полоса → ожидающая задача пишет в лог, КТО именно мешает."""
        self.assertTrue(es.HEAVY_SEM.acquire(timeout=1),
                        "не удалось занять heavy-полосу для теста")
        released = False
        try:
            es.JOBS["b1"] = {
                "id": "b1", "type": "convert", "status": "running", "lane": "heavy",
                "label": "блокер.mp4", "started_at": time.time() - 60,
            }
            job = {
                "id": "q1", "type": "convert", "status": "queued", "lane": "heavy",
                "params": {},
                # такой же словарь, как создаёт handle_job_create (progress не None)
                "progress": {"active": True, "task": "convert", "stage": "В очереди",
                             "percent": 0, "eta": "", "log": []},
                "result": None, "error": None,
                "label": "ожидатор.mp4", "created_at": time.time(),
                "finished_at": None, "worker": es.DummyWorker(),
            }
            es.JOBS["q1"] = job
            # мокаем саму конвертацию — задача выполнится мгновенно после слота
            self.patch(es, "task_convert", lambda params, log, worker=None: {"ok": True})

            done = threading.Event()

            def runner():
                es.run_job(job)
                done.set()

            th = threading.Thread(target=runner, daemon=True)
            th.start()

            # ждём, пока задача встанет в очередь и напишет про блокировщика
            deadline = time.time() + 5
            text = ""
            while time.time() < deadline:
                text = "\n".join((job.get("progress") or {}).get("log") or [])
                if "Движок занят: Конвертация «блокер.mp4»" in text:
                    break
                time.sleep(0.1)
            self.assertIn(
                "Движок занят: Конвертация «блокер.mp4»", text,
                f"лог очереди не называет блокирующую задачу:\n{text}",
            )
        finally:
            es.HEAVY_SEM.release()  # отпускаем полосу — задача доработает
            released = True
        # после освобождения слота задача обязана завершиться сама
        self.assertTrue(done.wait(timeout=15), "задача не завершилась после release")
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["result"], {"ok": True})


class TestJobsJournalRobustness(EngineQueueTestBase):
    def test_sorted_entries_tolerate_created_at_none(self):
        """Регрессия живого сбоя: записи без created_at (тестовый мусор в
        jobs.json) роняли сортировку /api/jobs с TypeError → 500 → панель
        очереди исчезала с сайта (listEngineJobsFull получал не-200)."""
        now = time.time()
        es.JOBS["bad"] = {
            "id": "bad", "type": "convert", "status": "done",
            "created_at": None, "finished_at": now,
        }
        es.JOBS["good"] = {
            "id": "good", "type": "convert", "status": "done",
            "created_at": now, "finished_at": now,
        }
        entries = es._sorted_job_entries()
        self.assertEqual(len(entries), 2)  # не упало
        # «хорошая» запись позже «плохой» (None считается как 0)
        self.assertEqual([j["id"] for j in entries], ["bad", "good"])
        # и обрезка журнала тоже не падает
        old_max = es.JOBS_MAX
        es.JOBS_MAX = 1
        try:
            es._prune_jobs()
            self.assertEqual(len(es.JOBS), 1)
        finally:
            es.JOBS_MAX = old_max


if __name__ == "__main__":
    unittest.main()
