use crate::agent::run_agent;
use crate::market::read_quote;

pub fn execute_order(symbol: &str) -> bool {
    run_agent(symbol, read_quote(symbol))
}
