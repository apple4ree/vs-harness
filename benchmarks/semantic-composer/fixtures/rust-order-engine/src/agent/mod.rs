use crate::risk::approve_order;

pub fn run_agent(symbol: &str, quote: f64) -> bool {
    for attempt in 0..3 {
        if approve_order(symbol, quote, attempt) { return true; }
    }
    false
}
