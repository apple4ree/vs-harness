from risk.policy import approve_order

def run_agent(symbol: str, quote: float) -> bool:
    for attempt in range(3):
        if approve_order(symbol, quote, attempt):
            return True
    return False
