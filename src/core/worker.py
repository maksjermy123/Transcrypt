from PyQt6.QtCore import QThread, pyqtSignal
import logging

class TaskWorker(QThread):
    # Signals
    progress = pyqtSignal(int) # 0-100
    log = pyqtSignal(object)   # Log message (str) or (str, link)
    status_update = pyqtSignal(int, str) # index, status
    file_result = pyqtSignal(int, str)   # index, result_path
    file_retry_available = pyqtSignal(int)  # failed row available for retry
    finished = pyqtSignal(object) # Result data
    error = pyqtSignal(str)    # Error message

    def __init__(self, task_func, *args, **kwargs):
        super().__init__()
        self.task_func = task_func
        self.args = args
        self.kwargs = kwargs
        self.logger = logging.getLogger(__name__)
        self._stop_requested = False
        self.active_process = None
        
    def request_stop(self):
        self._stop_requested = True
        try:
            from src.utils.event_log import get_event_log

            get_event_log().write("worker_stop_requested")
        except Exception:
            pass
        if self.active_process:
            try:
                self.active_process.kill()
                self.logger.info("🔪 Подпроцесс принудительно завершен.")
            except Exception as e:
                self.logger.warning(f"Не удалось завершить подпроцесс: {e}")
                pass
        
    def is_stop_requested(self):
        return self._stop_requested

    def run(self):
        try:
            self.logger.info("Worker started.")
            try:
                from src.utils.event_log import get_event_log

                get_event_log().write("worker_start", task=str(getattr(self.task_func, "__name__", "task_func")))
            except Exception:
                pass
            result = self.task_func(self, *self.args, **self.kwargs)
            self.finished.emit(result)
        except Exception as e:
            self.logger.error(f"Worker error: {e}")
            import traceback
            self.logger.error(traceback.format_exc())
            try:
                from src.utils.event_log import get_event_log

                get_event_log().write("worker_error", error=str(e))
            except Exception:
                pass
            self.error.emit(str(e))
