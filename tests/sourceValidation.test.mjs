import test from "node:test";
import assert from "node:assert/strict";
import {
  validateSourceUrl,
  normalizeExtension,
  isValidExtension,
  findDuplicateSource,
  validateAddAppInput,
  buildTrackedSource,
} from "../src/lib/sourceValidation.ts";

test("validateSourceUrl accepts HTTPS repositories and rejects bad URLs", () => {
  const url = validateSourceUrl("https://github.com/owner/repo");
  assert.equal(url.hostname, "github.com");
  assert.throws(() => validateSourceUrl("http://github.com/owner/repo"), /HTTPS/);
  assert.throws(() => validateSourceUrl("https://github.com/owner"), /repository/);
  assert.throws(() => validateSourceUrl("not a url"), /valid HTTPS/);
  assert.throws(() => validateSourceUrl("https://user:pass@github.com/owner/repo"), /HTTPS/);
});

test("normalizeExtension and isValidExtension handle dotted and bare extensions", () => {
  assert.equal(normalizeExtension("zip"), ".zip");
  assert.equal(normalizeExtension(".tar.gz"), ".tar.gz");
  assert.equal(normalizeExtension(""), undefined);
  assert.equal(isValidExtension(".zip"), true);
  assert.equal(isValidExtension(".tar.gz"), true);
  assert.equal(isValidExtension("zip"), false);
  assert.equal(isValidExtension(".a/b"), false);
});

test("findDuplicateSource ignores the source being edited", () => {
  const sources = [{ id: "one", url: "https://github.com/owner/repo" }];
  assert.equal(findDuplicateSource(sources, "https://github.com/owner/repo", "one"), undefined);
  assert.equal(findDuplicateSource(sources, "https://github.com/owner/repo", "two")?.id, "one");
});

test("buildTrackedSource creates a normalized tracked source and rejects duplicates", () => {
  const source = buildTrackedSource(
    { url: "https://github.com/owner/repo", extension: "zip", architecture: "x86_64", appIdentifier: "org.app" },
    [],
  );
  assert.match(source.id, /.+/);
  assert.equal(source.repo, "github.com/owner/repo");
  assert.equal(source.url, "https://github.com/owner/repo");
  assert.equal(source.assetExtension, ".zip");
  assert.equal(source.assetArchitecture, "x86_64");
  assert.equal(source.appIdentifier, "org.app");
  assert.equal(source.version, "");
  assert.throws(() =>
    buildTrackedSource({ url: "https://github.com/owner/repo" }, [source]),
  );
});

test("validateAddAppInput preserves current source fields when editing the same URL", () => {
  const current = {
    id: "existing",
    repo: "github.com/owner/repo",
    url: "https://github.com/owner/repo",
    version: "1.0.0",
    assetName: "app.zip",
    assetUrl: "https://host/app.zip",
    checkedAt: "2026-01-01T00:00:00.000Z",
    error: "",
    lastKnownInstalledVersion: "1.0.0",
    installedVersionSource: "manual",
    iconUrl: "https://icon",
  };
  const source = buildTrackedSource(
    { url: "https://github.com/owner/repo" },
    [current],
    "existing",
    current,
  );
  assert.equal(source.id, "existing");
  assert.equal(source.lastKnownInstalledVersion, "1.0.0");
  assert.equal(source.installedVersionSource, "manual");
  assert.equal(source.iconUrl, "https://icon");
});
