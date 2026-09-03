import { approveOrder } from "../risk/policy";

export function runAgent(symbol: string, quote: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (approveOrder(symbol, quote, attempt)) return true;
  }
  return false;
}
