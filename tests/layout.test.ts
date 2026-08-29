import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LAYOUT,
  fitLayout,
  validateLayout,
} from "../apps/desktop/src/shared/layout";

test("panel layout validates persisted sizes and keeps the editor visible in smaller windows", () => {
  assert.deepEqual(validateLayout(undefined), DEFAULT_LAYOUT);
  assert.throws(() => validateLayout({ ...DEFAULT_LAYOUT, left: 10 }));
  assert.throws(() => validateLayout({ ...DEFAULT_LAYOUT, terminal: NaN }));
  for (const width of [980, 1100, 1440, 2200]) {
    for (const height of [520, 700, 1200]) {
      const fitted = fitLayout(
        { left: 420, right: 650, terminal: 600 },
        width,
        height,
      );
      assert(fitted.left >= 160 && fitted.left <= 420);
      assert(fitted.right >= 240 && fitted.right <= 650);
      assert(fitted.left + fitted.right + 328 <= width);
      assert(fitted.terminal >= 120 && fitted.terminal <= height - 250);
    }
  }
});
