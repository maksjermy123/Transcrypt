from __future__ import annotations

import threading
import uuid
from collections import deque
from dataclasses import dataclass

from PyQt6.QtCore import QObject, QTimer, pyqtSignal


@dataclass
class _QueuedTask:
    token: str
    label: str
    callback: object


class _ProcessingNotifier(QObject):
    state_changed = pyqtSignal(object)


class _ProcessingScheduler:
    def __init__(self):
        self._lock = threading.Lock()
        self._active: _QueuedTask | None = None
        self._queue: deque[_QueuedTask] = deque()
        self._notifier = _ProcessingNotifier()

    def _snapshot_locked(self):
        return {
            "active_label": self._active.label if self._active else None,
            "queue": [{"token": item.token, "label": item.label} for item in self._queue],
        }

    def _emit_state(self):
        with self._lock:
            snapshot = self._snapshot_locked()
        self._notifier.state_changed.emit(snapshot)

    def schedule(self, label: str, callback):
        task = _QueuedTask(token=uuid.uuid4().hex, label=label, callback=callback)
        with self._lock:
            if self._active is None:
                self._active = task
                started = True
                position = 0
                active_label = label
            else:
                self._queue.append(task)
                started = False
                position = len(self._queue)
                active_label = self._active.label
        self._emit_state()
        if started:
            QTimer.singleShot(0, callback)
        return {
            "token": task.token,
            "started": started,
            "position": position,
            "active_label": active_label,
        }

    def cancel(self, token: str) -> bool:
        removed = False
        with self._lock:
            for item in list(self._queue):
                if item.token == token:
                    self._queue.remove(item)
                    removed = True
                    break
        if removed:
            self._emit_state()
        return removed

    def complete(self, token: str | None):
        next_task = None
        with self._lock:
            if self._active and (token is None or self._active.token == token):
                self._active = None
            if self._active is None and self._queue:
                next_task = self._queue.popleft()
                self._active = next_task
        self._emit_state()
        if next_task is not None:
            QTimer.singleShot(0, next_task.callback)
        return next_task.label if next_task is not None else None

    def active_label(self) -> str | None:
        with self._lock:
            return self._active.label if self._active else None

    def snapshot(self):
        with self._lock:
            return self._snapshot_locked()

    def notifier(self):
        return self._notifier


_SCHEDULER = _ProcessingScheduler()


def schedule_processing(label: str, callback):
    return _SCHEDULER.schedule(label, callback)


def cancel_processing(token: str | None) -> bool:
    if not token:
        return False
    return _SCHEDULER.cancel(token)


def release_processing(token: str | None = None):
    return _SCHEDULER.complete(token)


def active_processing_label() -> str | None:
    return _SCHEDULER.active_label()


def processing_snapshot():
    return _SCHEDULER.snapshot()


def processing_notifier():
    return _SCHEDULER.notifier()
