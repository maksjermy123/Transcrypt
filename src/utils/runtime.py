import os


def recommended_cpu_threads(cpu_count: int | None = None) -> int:
    cpu_total = int(cpu_count or os.cpu_count() or 1)
    if cpu_total <= 2:
        return 1
    reserve = max(1, cpu_total // 4)
    return max(1, min(8, cpu_total - reserve))


def parse_thread_setting(value) -> int:
    cpu_total = int(os.cpu_count() or 1)
    if value is None:
        return recommended_cpu_threads(cpu_total)

    raw = str(value).strip()
    if not raw or raw.lower() == "auto":
        return recommended_cpu_threads(cpu_total)

    try:
        parsed = int(raw)
    except Exception:
        return recommended_cpu_threads(cpu_total)

    return max(1, min(cpu_total, parsed))


def resolve_whisper_device(value) -> str:
    raw = str(value or "Auto").strip().lower()
    if raw == "gpu":
        return "cuda"
    if raw == "cpu":
        return "cpu"

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def apply_runtime_thread_limits(num_threads: int) -> int:
    threads = max(1, int(num_threads or 1))
    thread_value = str(threads)
    for name in (
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "VECLIB_MAXIMUM_THREADS",
        "NUMEXPR_NUM_THREADS",
    ):
        os.environ[name] = thread_value

    try:
        import torch

        torch.set_num_threads(threads)
        try:
            torch.set_num_interop_threads(max(1, min(threads, 4)))
        except RuntimeError:
            pass
    except Exception:
        pass

    return threads
