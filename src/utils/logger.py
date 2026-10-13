import os
import logging
import sys
import time
from logging.handlers import RotatingFileHandler

from src.utils.app_paths import logs_dir as app_logs_dir

_LOGGER_INITIALIZED = False
_ROOT_LOGGER = None


def _logs_dir():
    d = app_logs_dir()
    os.makedirs(d, exist_ok=True)
    return d

def setup_logger():
    """Configures the application logger."""
    global _LOGGER_INITIALIZED, _ROOT_LOGGER
    
    if _LOGGER_INITIALIZED:
        return _ROOT_LOGGER
    
    log_format = "%(asctime)s [%(levelname)s] %(message)s"
    date_format = "%Y-%m-%d %H:%M:%S"

    logs_dir = _logs_dir()
    session_stamp = time.strftime("%Y%m%d-%H%M%S")
    session_log = os.path.join(logs_dir, f"app-{session_stamp}.log")
    rolling_log = os.path.join(logs_dir, "app-latest.log")

    file_handlers = [
        logging.FileHandler(session_log, mode="a", encoding="utf-8"),
        RotatingFileHandler(rolling_log, maxBytes=2_000_000, backupCount=3, encoding="utf-8"),
    ]

    logging.basicConfig(
        level=logging.INFO,
        format=log_format,
        datefmt=date_format,
        handlers=[
            logging.StreamHandler(sys.stdout),
            *file_handlers,
        ],
    )
    
    _ROOT_LOGGER = logging.getLogger()
    _LOGGER_INITIALIZED = True
    logging.info("Logger initialized.")
    return _ROOT_LOGGER


def get_logger(name: str = None) -> logging.Logger:
    """Get logger instance for a module.
    
    Args:
        name: Logger name (usually __name__)
        
    Returns:
        Logger instance
    """
    if not _LOGGER_INITIALIZED:
        setup_logger()
    
    return logging.getLogger(name)
