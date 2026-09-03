def approve_order(symbol: str, quote: float, attempt: int) -> bool:
    return bool(symbol) and quote > 0 and attempt < 2
