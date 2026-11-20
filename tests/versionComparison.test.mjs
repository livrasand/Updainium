import test from "node:test";
import assert from "node:assert/strict";
import {
  extractVersionNumbers,
  resolveInstalledVersion,
  hasUpdate,
  versionsEqual,
  isInstalledVersionCurrent,
} from "../src/lib/versionComparison.ts";

test("extractVersionNumbers handles dotted and spaced versions", () => {
  assert.deepEqual(extractVersionNumbers("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(extractVersionNumbers("2026.11.20"), [2026, 11, 20]);
  assert.equal(extractVersionNumbers("no digits"), null);
});

test("resolveInstalledVersion prefers manual versions over detected ones", () => {
  const source = {
    id: "app",
    version: "2.0.0",
    lastKnownInstalledVersion: "1.5.0",
    installedVersionSource: "manual",
  };
  assert.equal(resolveInstalledVersion(source, "1.9.0"), "1.5.0");
  assert.equal(resolveInstalledVersion({ ...source, installedVersionSource: "detected" }, "1.9.0"), "1.9.0");
  assert.equal(resolveInstalledVersion({ ...source, installedVersionSource: undefined, lastKnownInstalledVersion: undefined }, null), null);
});

test("hasUpdate compares numeric version parts", () => {
  assert.equal(hasUpdate("1.2.3", "1.2.4"), true);
  assert.equal(hasUpdate("1.2.3", "1.2.3"), false);
  assert.equal(hasUpdate("1.2.3", "1.1.9"), false);
  assert.equal(hasUpdate("1.2", "1.2.1"), true);
  assert.equal(hasUpdate("", "1.0.0"), false);
  assert.equal(hasUpdate("1.0.0", ""), false);
});

test("versionsEqual and isInstalledVersionCurrent handle missing values", () => {
  assert.equal(versionsEqual("1.2.3", "v1.2.3"), true);
  assert.equal(versionsEqual("1.2.3", "1.2.4"), false);
  assert.equal(isInstalledVersionCurrent("1.2.3", "1.2.3"), true);
  assert.equal(isInstalledVersionCurrent("", "1.2.3"), false);
});
