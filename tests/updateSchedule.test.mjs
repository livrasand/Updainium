import test from "node:test";
import assert from "node:assert/strict";
import {
  availableUpdateSignature,
  isUpdateCheckDue,
  normalizeUpdateCheckInterval,
} from "../src/lib/updateSchedule.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("unknown or missing intervals fall back to disabled", () => {
  assert.equal(normalizeUpdateCheckInterval(undefined), "disabled");
  assert.equal(normalizeUpdateCheckInterval("yearly"), "disabled");
  assert.equal(normalizeUpdateCheckInterval("weekly"), "weekly");
});

test("disabled interval is never due", () => {
  assert.equal(isUpdateCheckDue("disabled", undefined, Date.now()), false);
});

test("an interval is due immediately when it has never run", () => {
  assert.equal(isUpdateCheckDue("daily", undefined, Date.now()), true);
});

test("an interval becomes due once its period has elapsed", () => {
  const now = 10 * DAY;
  assert.equal(isUpdateCheckDue("daily", now - DAY + 1, now), false);
  assert.equal(isUpdateCheckDue("daily", now - DAY, now), true);
  assert.equal(isUpdateCheckDue("hourly", now - HOUR, now), true);
});

test("update signature is stable regardless of order", () => {
  const a = { id: "a", version: "1.0.0" };
  const b = { id: "b", version: "2.0.0" };
  assert.equal(availableUpdateSignature([a, b]), availableUpdateSignature([b, a]));
  assert.equal(availableUpdateSignature([]), "");
});

test("update signature changes when a version changes", () => {
  const before = availableUpdateSignature([{ id: "a", version: "1.0.0" }]);
  const after = availableUpdateSignature([{ id: "a", version: "1.0.1" }]);
  assert.notEqual(before, after);
});
