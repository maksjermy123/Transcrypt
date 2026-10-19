"""Diagnostics and system information collection."""

import os
import sys
import platform
import json
import subprocess
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
import importlib.util

from src.utils.winproc import no_window_kwargs

from src.utils.logger import get_logger
from src.utils.app_paths import logs_dir as app_logs_dir

logger = get_logger(__name__)


class SystemDiagnostics:
    """Collect system and application diagnostics."""
    
    @staticmethod
    def collect_system_info() -> Dict[str, Any]:
        """Collect basic system information."""
        return {
            'timestamp': datetime.now().isoformat(),
            'os': {
                'system': platform.system(),
                'release': platform.release(),
                'version': platform.version(),
                'machine': platform.machine(),
            },
            'python': {
                'version': platform.python_version(),
                'implementation': platform.python_implementation(),
                'compiler': platform.python_compiler(),
                'executable': sys.executable,
            },
            'cpu': {
                'processor': platform.processor(),
                'core_count': os.cpu_count(),
            },
        }
    
    @staticmethod
    def check_dependencies() -> Dict[str, Dict[str, Any]]:
        """Check availability of key dependencies."""
        dependencies = {
            'ffmpeg': {'description': 'Video processing', 'required': True},
            'LibreOffice': {'description': 'Document conversion', 'required': False},
            'pdf2docx': {'description': 'PDF to DOCX conversion', 'required': True},
            'yt-dlp': {'description': 'Video download', 'required': False},
            'PyQt6': {'description': 'GUI framework', 'required': True},
            'torch': {'description': 'Deep learning framework', 'required': True},
            'whisper': {'description': 'Speech recognition', 'required': False},
            'deepl': {'description': 'Translation API', 'required': False},
            'PIL': {'description': 'Image processing', 'required': False},
        }
        
        results = {}
        for dep_name, info in dependencies.items():
            status = SystemDiagnostics._check_single_dependency(dep_name)
            results[dep_name] = {
                'available': status['available'],
                'version': status['version'],
                'description': info['description'],
                'required': info['required'],
                'location': status.get('location'),
                'error': status.get('error'),
            }
        
        return results
    
    @staticmethod
    def _check_single_dependency(name: str) -> Dict[str, Any]:
        """Check if a single dependency is available."""
        result = {'available': False, 'version': None, 'location': None}
        
        # Special case for external binaries
        if name == 'ffmpeg':
            path = shutil.which('ffmpeg')
            if path:
                try:
                    output = subprocess.check_output(['ffmpeg', '-version'], 
                                                   stderr=subprocess.STDOUT, 
                                                   encoding="utf-8", errors="replace", timeout=5, **no_window_kwargs())
                    version_line = output.split('\n')[0]
                    result['available'] = True
                    result['version'] = version_line
                    result['location'] = path
                except Exception as e:
                    result['error'] = str(e)
            return result
        
        if name == 'LibreOffice':
            # Try common LibreOffice paths
            paths_to_try = [
                shutil.which('soffice'),
                shutil.which('libreoffice'),
                '/Applications/LibreOffice.app/Contents/MacOS/soffice',  # macOS
                'C:\\Program Files\\LibreOffice\\program\\soffice.exe',   # Windows
            ]
            for path in paths_to_try:
                if path and os.path.exists(path):
                    result['available'] = True
                    result['location'] = path
                    return result
            return result
        
        # Python packages
        try:
            module = importlib.import_module(name)
            result['available'] = True
            result['location'] = module.__file__
            
            if hasattr(module, '__version__'):
                result['version'] = module.__version__
            
        except ImportError:
            pass
        except Exception as e:
            result['error'] = str(e)
        
        return result
    
    @staticmethod
    def check_file_access() -> Dict[str, Dict[str, bool]]:
        """Check if critical directories are accessible."""
        dirs_to_check = {
            'app_logs': app_logs_dir(),
            'home': str(Path.home()),
            'temp': os.path.expanduser('~/Downloads'),
        }
        
        results = {}
        for name, path in dirs_to_check.items():
            results[name] = {
                'path': path,
                'exists': os.path.exists(path),
                'readable': os.access(path, os.R_OK) if os.path.exists(path) else False,
                'writable': os.access(path, os.W_OK) if os.path.exists(path) else False,
            }
        
        return results
    
    @staticmethod
    def check_disk_space() -> Dict[str, Any]:
        """Check available disk space."""
        try:
            home_path = Path.home()
            stats = shutil.disk_usage(str(home_path))
            
            return {
                'total_gb': stats.total / (1024**3),
                'used_gb': stats.used / (1024**3),
                'free_gb': stats.free / (1024**3),
                'percent_used': (stats.used / stats.total) * 100,
            }
        except Exception as e:
            return {'error': str(e)}
    
    @staticmethod
    def get_recent_errors(max_errors: int = 10) -> List[str]:
        """Get recent errors from log files."""
        errors = []
        
        try:
            logs_path = Path(app_logs_dir())
            if logs_path.exists():
                latest_log = logs_path / 'app-latest.log'
                if latest_log.exists():
                    with open(latest_log, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = f.readlines()
                        # Get lines with ERROR or CRITICAL
                        error_lines = [l.strip() for l in lines if 'ERROR' in l or 'CRITICAL' in l]
                        errors = error_lines[-max_errors:]
        except Exception as e:
            logger.warning(f"Could not read error logs: {e}")
        
        return errors
    
    @staticmethod
    def get_warnings(max_warnings: int = 10) -> List[str]:
        """Get recent warnings from log files."""
        warnings = []
        
        try:
            logs_path = Path(app_logs_dir())
            if logs_path.exists():
                latest_log = logs_path / 'app-latest.log'
                if latest_log.exists():
                    with open(latest_log, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = f.readlines()
                        # Get lines with WARNING
                        warning_lines = [l.strip() for l in lines if 'WARNING' in l]
                        warnings = warning_lines[-max_warnings:]
        except Exception as e:
            logger.warning(f"Could not read warning logs: {e}")
        
        return warnings


class DiagnosticsCollector:
    """Main diagnostics collector."""
    
    @staticmethod
    def collect_full_report() -> Dict[str, Any]:
        """Collect complete diagnostics report."""
        report = {
            'version': '1.0',
            'system': SystemDiagnostics.collect_system_info(),
            'dependencies': SystemDiagnostics.check_dependencies(),
            'file_access': SystemDiagnostics.check_file_access(),
            'disk_space': SystemDiagnostics.check_disk_space(),
            'recent_errors': SystemDiagnostics.get_recent_errors(),
            'recent_warnings': SystemDiagnostics.get_warnings(),
        }
        
        return report
    
    @staticmethod
    def save_report_to_file(output_path: Optional[str] = None) -> str:
        """Save diagnostics report to file."""
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = os.path.expanduser(f'~/Desktop/voxpaper_diagnostics_{timestamp}.json')
        
        report = DiagnosticsCollector.collect_full_report()
        
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2)
        
        logger.info(f"Diagnostics report saved to: {output_path}")
        return output_path
    
    @staticmethod
    def print_report():
        """Print diagnostics report to console."""
        report = DiagnosticsCollector.collect_full_report()
        
        print("\n" + "="*70)
        print("📊 VOXPAPER AI - SYSTEM DIAGNOSTICS REPORT")
        print("="*70)
        
        # System info
        print("\n🖥️  SYSTEM INFO:")
        sys_info = report['system']
        print(f"  OS: {sys_info['os']['system']} {sys_info['os']['release']}")
        print(f"  Python: {sys_info['python']['version']}")
        print(f"  CPU Cores: {sys_info['cpu']['core_count']}")
        
        # Dependencies
        print("\n📦 DEPENDENCIES:")
        deps = report['dependencies']
        for dep_name, info in deps.items():
            status = "✓" if info['available'] else "✗"
            version = f" ({info['version']})" if info['version'] else ""
            required = " [REQUIRED]" if info['required'] else ""
            print(f"  {status} {dep_name}{version}{required}")
            if info.get('error'):
                print(f"    Error: {info['error']}")
        
        # Disk space
        print("\n💾 DISK SPACE:")
        disk = report['disk_space']
        if 'error' not in disk:
            print(f"  Free: {disk['free_gb']:.1f}GB / {disk['total_gb']:.1f}GB ({100-disk['percent_used']:.1f}% free)")
        else:
            print(f"  Error: {disk['error']}")
        
        # Errors and warnings
        print("\n⚠️  RECENT ERRORS:")
        if report['recent_errors']:
            for err in report['recent_errors'][-5:]:
                print(f"  {err[:100]}")
        else:
            print("  None")
        
        print("\n⚠️  RECENT WARNINGS:")
        if report['recent_warnings']:
            for warn in report['recent_warnings'][-5:]:
                print(f"  {warn[:100]}")
        else:
            print("  None")
        
        print("\n" + "="*70 + "\n")


def run_diagnostics_cli():
    """Run diagnostics from command line."""
    collector = DiagnosticsCollector()
    print("Collecting diagnostics...")
    collector.print_report()
    
    output_file = collector.save_report_to_file()
    print(f"Full report saved to: {output_file}")


if __name__ == '__main__':
    run_diagnostics_cli()
