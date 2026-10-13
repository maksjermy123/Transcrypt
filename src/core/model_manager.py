import os
import shutil
import logging
import subprocess
import threading
import sys
import whisper

from src.utils.app_paths import app_support_dir, libs_dir, models_dir

class ModelManager:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        # Save models to application support for portability
        self.cache_dir = models_dir()
        os.makedirs(self.cache_dir, exist_ok=True)
        self.models = ["tiny", "base", "small", "medium", "large-v3"]
        
    def get_model_status(self):
        """Returns dict of {model_name: exists_bool}"""
        if not os.path.exists(self.cache_dir):
            return {m: False for m in self.models}
        return {
            model: os.path.isfile(os.path.join(self.cache_dir, f"{model}.pt"))
            for model in self.models
        }

    def _get_dir_size(self, path):
        total = 0
        try:
            for f in os.scandir(path):
                if f.is_file():
                    total += f.stat().st_size
        except FileNotFoundError:
            pass
        return total / (1024*1024) # MB

    def clear_cache(self):
        try:
            if os.path.exists(self.cache_dir):
                shutil.rmtree(self.cache_dir)
                os.makedirs(self.cache_dir, exist_ok=True)
            return True
        except Exception as e:
            self.logger.error(f"Failed to clear cache: {e}")
            return False

    def update_ytdlp(self):
        """Updates yt-dlp. Supports frozen app via library overlay."""
        if getattr(sys, 'frozen', False):
             return self.update_ytdlp_frozen()

        try:
            # Assumes python is available
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-U", "yt-dlp"])
            return True
        except Exception as e:
            self.logger.error(f"Failed to update yt-dlp: {e}")
            return False

    def update_ytdlp_frozen(self):
        """Downloads yt-dlp wheel and extracts to user libs folder."""
        import urllib.request
        import json
        import zipfile
        import io
        
        try:
            self.logger.info("Starting failed/frozen update sequence...")
            
            # 1. Get latest version info from PyPI
            url = "https://pypi.org/pypi/yt-dlp/json"
            with urllib.request.urlopen(url) as response:
                data = json.loads(response.read().decode())
                latest_version = data['info']['version']
                
            self.logger.info(f"Latest yt-dlp version: {latest_version}")
            
            # 2. Find the wheel file url
            wheel_url = None
            for url_info in data['urls']:
                if url_info['filename'].endswith('.whl'):
                    wheel_url = url_info['url']
                    break
            
            if not wheel_url:
                self.logger.error("No wheel file found for yt-dlp")
                return False
                
            # 3. Setup Target Directory
            target_libs_dir = libs_dir()
            os.makedirs(target_libs_dir, exist_ok=True)
            
            # 4. Download and Extract
            self.logger.info(f"Downloading wheel from {wheel_url}")
            with urllib.request.urlopen(wheel_url) as response:
                wheel_data = response.read()
                
            with zipfile.ZipFile(io.BytesIO(wheel_data)) as zf:
                # We only want the 'yt_dlp' folder
                for member in zf.namelist():
                    if member.startswith('yt_dlp/'):
                        zf.extract(member, target_libs_dir)
                        
            self.logger.info(f"Successfully extracted yt-dlp to {target_libs_dir}")
            return True

        except Exception as e:
            self.logger.error(f"Frozen update failed: {e}")
            import traceback
            self.logger.error(traceback.format_exc())
            return False

    def preload_model(self, model_name):
        """Downloads a model by loading it, then discarding."""
        try:
            whisper.load_model(model_name, download_root=self.cache_dir)
            return True
        except Exception as e:
            self.logger.error(f"Failed to download model {model_name}: {e}")
            raise e
