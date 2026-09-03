export function approveOrder(symbol: string, quote: number, attempt: number) {
  return Boolean(symbol) && quote > 0 && attempt < 2;
}
