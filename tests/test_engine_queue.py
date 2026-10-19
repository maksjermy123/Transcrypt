# -*- coding: utf-8 -*-
"""Регрессионные тесты видимости очереди задач движка (Task 50).

Баг: задача, запущенная в одной вкладке, занимала движок, а остальные вкладки
видели только безликое «Движок занят другой задачей» — виновника (какая
вкладка, какой файл, сколько идёт) найти было негде.

Фиксы, которые проверяем:
  1. _job_snapshot отдаёт started_at — по нему сайт считает «идёт N мин».
  2. _running_jobs_summary описывает блокирующую задачу (тип, файл, минуты).
  3. run_job при ожидании слота пишет в лог задачи ИМЯ блокирующей.
"""
import sys
import threading
import time
import types

import pytest

# ─── Заглушки тяжёлых ML-модулей ──────────────────────────────────────────────
# engine_server импортирует src.core.engine (torch + whisper) при импорте.
# Тестовая среда не тянет 2 ГБ весов ради проверки логики очереди — ставим
# минимальные фейки в sys.modules ДО импорта engine_server.
for _name in ("torch", "whisper", "deep_translator"):
    if _name not in sys.modules:
        _stub = types.ModuleType(_name)
        _stub.__getattr__ = lambda item: types.SimpleNamespace()  # любые атрибуты
        sys.modules[_name] = _stub

import engine_server as es


@pytest.fixture(autouse=True)
def _clean_jobs(tmp_path, monkeypatch):
    """Тесты изолированы от РЕАЛЬНОГО журнала задач пользователя:
    JOBS_FILE переносится в tmp_path (иначе _save_jobs из run_job записал
    бы тестовые задачи в ~/.local/share/VoxPaperAi/web_output/jobs.json —
    уже случалось: записи без created_at роняли сортировку /api/jobs).
    Плюс чистим глобальный JOBS после каждого теста."""
    monkeypatch.setattr(es, "JOBS_FILE", str(tmp_path / "jobs.json"))
    before = dict(es.JOBS)
    yield
    es.JOBS.clear()
    es.JOBS.update(before)


def test_job_snapshot_has_started_at():
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
    assert snap["started_at"] == now - 5
    # обратная совместимость: старые поля на месте
    assert snap["job_id"] == "snap1"
    assert snap["type"] == "convert"
    assert snap["label"] == "видео.mp4"


def test_running_jobs_summary_names_blocker():
    now = time.time()
    es.JOBS["b1"] = {
        "id": "b1", "type": "convert", "status": "running", "lane": "heavy",
        "label": "Уборщик ЗАРУБИЛСЯ.mp4", "started_at": now - 130,
    }
    try:
        s = es._running_jobs_summary("heavy")
        assert "Конвертация" in s
        assert "Уборщик ЗАРУБИЛСЯ.mp4" in s
        assert "идёт 2 мин" in s
        # другая полоса свободна
        assert es._running_jobs_summary("light") == ""
    finally:
        es.JOBS.pop("b1", None)


def test_running_jobs_summary_empty_when_idle():
    assert es._running_jobs_summary("heavy") == ""


def test_run_job_queue_message_names_blocker(monkeypatch):
    """Занятая полоса → ожидающая задача пишет в лог, КТО именно мешает."""
    assert es.HEAVY_SEM.acquire(timeout=1), "не удалось занять heavy-полосу для теста"
    th = None
    try:
        es.JOBS["b1"] = {
            "id": "b1", "type": "convert", "status": "running", "lane": "heavy",
            "label": "блокер.mp4", "started_at": time.time() - 60,
        }
        job = {
            "id": "q1", "type": "convert", "status": "queued", "lane": "heavy",
            "params": {},
            # такой же словарь, как создаёт handle_job_create (progress не бывает None)
            "progress": {"active": True, "task": "convert", "stage": "В очереди",
                         "percent": 0, "eta": "", "log": []},
            "result": None, "error": None,
            "label": "ожидатор.mp4", "created_at": time.time(),
            "finished_at": None, "worker": es.DummyWorker(),
        }
        es.JOBS["q1"] = job
        # мокаем саму конвертацию — задача выполнится мгновенно после получения слота
        monkeypatch.setattr(
            es, "task_convert",
            lambda params, log, worker=None: {"ok": True},
        )

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
        assert "Движок занят: Конвертация «блокер.mp4»" in text, (
            f"лог очереди не называет блокирующую задачу:\n{text}"
        )
    finally:
        es.HEAVY_SEM.release()  # отпускаем полосу — задача дработается
        if th is not None:
            th.join(timeout=10)
        es.JOBS.pop("b1", None)
        es.JOBS.pop("q1", None)

    assert job["status"] == "done"
    assert job["result"] == {"ok": True}


def test_snapshot_started_at_survives_save_load_roundtrip():
    """started_at сохраняется в jobs.json и восстанавливается после перезапуска."""
    now = time.time()
    es.JOBS["s1"] = {
        "id": "s1", "type": "transcribe", "status": "running", "lane": "heavy",
        "label": "лекция.mp3", "created_at": now - 100, "started_at": now - 90,
        "finished_at": None,
    }
    try:
        es._save_jobs()
    finally:
        es.JOBS.pop("s1", None)

    es._load_jobs()
    try:
        snap = es._job_snapshot(es.JOBS["s1"])
        # незавершённая после «перезапуска» помечается ошибкой, но started_at остаётся
        assert snap["status"] == "error"
        assert snap["started_at"] == now - 90
    finally:
        es.JOBS.pop("s1", None)


def test_sorted_entries_tolerate_created_at_none(monkeypatch):
    """Регрессия живого сбоя: записи без created_at (тестовый мусор в jobs.json)
    роняли сортировку /api/jobs с TypeError → 500 → панель очереди исчезала
    с сайта, потому что listEngineJobsFull() получал не-200."""
    now = time.time()
    es.JOBS["bad"] = {
        "id": "bad", "type": "convert", "status": "done",
        "created_at": None, "finished_at": now,
    }
    es.JOBS["good"] = {
        "id": "good", "type": "convert", "status": "done",
        "created_at": now, "finished_at": now,
    }
    try:
        entries = es._sorted_job_entries()
        assert len(entries) == 2  # не упало
        # «хорошая» запись позже «плохой» (None считается как 0)
        assert [j["id"] for j in entries] == ["bad", "good"]
        # и обрезка журнала тоже не падает
        monkeypatch.setattr(es, "JOBS_MAX", 1)
        es._prune_jobs()
        assert len(es.JOBS) == 1
    finally:
        es.JOBS.pop("bad", None)
        es.JOBS.pop("good", None)
