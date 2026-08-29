import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName } from "../src/domain/profile.js";
import { createGreeting } from "../src/services/greeting.js";
import { renderGreeting } from "../src/ui/presenter.js";

test("names are normalized and empty names use a friendly fallback", () => {
  assert.equal(normalizeName("  wise   traveler  "), "wise traveler");
  assert.equal(normalizeName("  "), "traveler");
  assert.throws(() => normalizeName(null), /must be text/);
});

test("the greeting and presentation compose without external services", () => {
  assert.equal(createGreeting("Witch"), "Hello, Witch.");
  assert.equal(
    renderGreeting(createGreeting("Witch")),
    "✦ Witch observatory\nHello, Witch.",
  );
});
