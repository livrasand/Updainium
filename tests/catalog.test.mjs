import test from "node:test";
import assert from "node:assert/strict";
import { isValidTrackedSource, normalizeSavedSource } from "../src/lib/catalog.ts";

const validSource = {
  id: "0b9e6c2e-1f6d-4a2e-9c3a-5f1d2b3c4d5e",
  repo: "github.com/owner/repo",
  url: "https://github.com/owner/repo",
  version: "1.2.3",
  assetName: "app-1.2.3.msi",
  assetUrl: "https://github.com/owner/repo/releases/download/v1.2.3/app-1.2.3.msi",
  checkedAt: "2026-11-16T00:00:00.000Z",
  error: "",
};

test("a complete saved source validates", () => {
  assert.equal(isValidTrackedSource(validSource), true);
});

test("a saved source without optional fields validates", () => {
  assert.equal(isValidTrackedSource({ ...validSource, appIdentifier: undefined }), true);
});

test("a saved source with wrong field types is rejected", () => {
  assert.equal(isValidTrackedSource({ ...validSource, version: 123 }), false);
  assert.equal(isValidTrackedSource({ ...validSource, releaseNotes: 42 }), false);
  assert.equal(isValidTrackedSource({ ...validSource, assetArchitecture: "riscv" }), false);
  assert.equal(isValidTrackedSource({ ...validSource, hashVerified: "yes" }), false);
  assert.equal(isValidTrackedSource([validSource]), false);
  assert.equal(isValidTrackedSource(null), false);
});

test("a release without a description saved as null still validates (issue #58)", () => {
  const savedAsV1_4_0 = { ...validSource, releaseNotes: null, releaseDate: null };
  assert.equal(isValidTrackedSource(savedAsV1_4_0), false);

  const restored = normalizeSavedSource(savedAsV1_4_0);
  assert.equal(isValidTrackedSource(restored), true);
  assert.equal(restored.releaseNotes, undefined);
  assert.equal(restored.releaseDate, undefined);
});

test("normalization round-trips the catalog without null values", () => {
  const savedAsV1_4_0 = [
    validSource,
    { ...validSource, id: "11111111-2222-3333-4444-555555555555", releaseNotes: null },
  ];
  const stored = JSON.stringify(savedAsV1_4_0);
  assert.match(stored, /"releaseNotes":null/);

  const restored = JSON.parse(stored).map(normalizeSavedSource);
  assert.equal(restored.every(isValidTrackedSource), true);

  const rewritten = JSON.stringify(restored);
  assert.doesNotMatch(rewritten, /:null/);
  assert.equal(JSON.parse(rewritten)[1].releaseNotes, undefined);
});

test("a catalog with required fields dropped by normalization is still rejected", () => {
  const restored = normalizeSavedSource({ ...validSource, id: null });
  assert.equal(isValidTrackedSource(restored), false);
});
