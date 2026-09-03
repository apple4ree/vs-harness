pub fn approve_order(symbol: &str, quote: f64, attempt: u32) -> bool {
    !symbol.is_empty() && quote > 0.0 && attempt < 2
}
