def format_timestamp_compact(seconds: float):
    """
    Formats timestamp as (MM:SS) or (HH:MM:SS).
    Removes milliseconds and end time.
    """
    seconds = int(round(seconds))
    hours = seconds // 3600
    seconds %= 3600
    minutes = seconds // 60
    seconds %= 60
    
    if hours > 0:
        return f"({hours:02d}:{minutes:02d}:{seconds:02d})"
    else:
        return f"({minutes:02d}:{seconds:02d})"
