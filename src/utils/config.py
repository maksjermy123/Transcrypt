import json
import os
import logging
import shutil

from src.utils.app_paths import config_file_path, default_output_dir, legacy_config_file_path

CONFIG_FILE = config_file_path()
LEGACY_CONFIG_FILE = legacy_config_file_path()

DEFAULT_CONFIG = {
    "disclaimer_accepted": False,
    "device": "Auto",
    "cpu_threads": "Auto",
    "transcription_output_dir": default_output_dir("whisper_output"),
    "converter_output_dir": default_output_dir("converted_output"),
    "model": "base",
    "source_lang": "auto",
    "target_lang": "-",
    "chk_download_video": False,
    "chk_download_audio": False,
    "chk_timecodes": True,
    "chk_save_audio": False,
    "chk_save_video": False,

    # Translation
    "translation_provider": "Google",
    "deepl_api_key": ""
    ,
    "translation_pdf_mode": "LAYOUT",
}

def load_config():
    if not os.path.exists(CONFIG_FILE) and os.path.exists(LEGACY_CONFIG_FILE):
        try:
            os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
            shutil.copy2(LEGACY_CONFIG_FILE, CONFIG_FILE)
        except Exception as e:
            logging.warning(f"Failed to migrate legacy config: {e}")
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return {**DEFAULT_CONFIG, **json.load(f)}
        except Exception as e:
            logging.error(f"Failed to load config: {e}")
    return DEFAULT_CONFIG.copy()

def save_config(config):
    try:
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=4, ensure_ascii=False)
    except Exception as e:
        logging.error(f"Failed to save config: {e}")
