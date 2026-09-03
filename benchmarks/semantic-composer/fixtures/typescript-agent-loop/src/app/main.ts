import { runAgent } from "../agent/runner";
import { readQuote } from "../market/feed";

export function executeOrder(symbol: string) {
  return runAgent(symbol, readQuote(symbol));
}
