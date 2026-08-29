import { normalizeName } from "../domain/profile.js";

/** Build the greeting displayed by the observatory. */
export function createGreeting(name) {
  return `Hello, ${normalizeName(name)}.`;
}
