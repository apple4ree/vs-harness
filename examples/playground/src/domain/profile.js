/** Normalize a display name without accessing any external data. */
export function normalizeName(name) {
  if (typeof name !== "string") throw new TypeError("A name must be text");
  return name.trim().replace(/\s+/g, " ") || "traveler";
}
