from agent.runner import run_agent
from market.feed import read_quote

def execute_order(symbol: str) -> bool:
    quote = read_quote(symbol)
    return run_agent(symbol, quote)
