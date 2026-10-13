import json
import os
import threading
import time
import uuid

from src.utils.app_paths import logs_dir


def _default_log_dir() -> str:
    return logs_dir()


class EventLog:
    """
    Simple structured event logger (JSON Lines).
    Designed for post-mortem analysis of UI actions and processing steps.
    """

    def __init__(self, log_dir: str | None = None):
        self.log_dir = log_dir or _default_log_dir()
        os.makedirs(self.log_dir, exist_ok=True)

        self.session_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        self.path = os.path.join(self.log_dir, f"session-{self.session_id}.jsonl")
        self._lock = threading.Lock()

    def write(self, event_type: str, **data):
        record = {
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "t_ms": int(time.time() * 1000),
            "session": self.session_id,
            "type": event_type,
            "data": data,
        }
        line = json.dumps(record, ensure_ascii=False)
        with self._lock:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(line + "\n")


_GLOBAL = None
_GLOBAL_LOCK = threading.Lock()


def get_event_log() -> EventLog:
    global _GLOBAL
    with _GLOBAL_LOCK:
        if _GLOBAL is None:
            _GLOBAL = EventLog()
        return _GLOBAL
