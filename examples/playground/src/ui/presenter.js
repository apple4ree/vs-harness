/** Keep presentation separate from the greeting's domain logic. */
export function renderGreeting(message) {
  return ["✦ Witch observatory", message].join("\n");
}
