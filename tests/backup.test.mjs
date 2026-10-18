import test from "node:test";
import assert from "node:assert/strict";
import { createBackup, parseBackup, parseGistId, restoreSources, maxBackupBytes, maxBackupSources } from "../src/lib/backup.ts";

function fixture() {
  return {
    format: "updainium-backup", version: 1, exportedAt: "2026-10-12T00:00:00.000Z",
    settings: { backgroundEnabled: true, startOnLogin: false },
    sources: [{ id: "app-1", repo: "owner/app", url: "https://github.com/owner/app", assetArchitecture: "auto" }],
  };
}

test("shared gist imports accept IDs and GitHub URLs but reject other hosts and paths", () => {
  assert.equal(parseGistId(" abc123 "), "abc123");
  assert.equal(parseGistId("https://gist.github.com/alice/abc123#file-updainium-settings-json"), "abc123");
  assert.equal(parseGistId("https://gist.github.com/abc123"), "abc123");
  for (const input of ["https://livrasand.com/alice/abc123", "https://token@gist.github.com/alice/abc123", "../abc", "not-an-id", "https://gist.github.com/"]) {
    assert.throws(() => parseGistId(input));
  }
});

test("exports portable app preferences and omits credentials and local caches", () => {
  const source = { ...fixture().sources[0], appIdentifier: "org.app", assetExtension: ".dmg",
    downloadPath: "/Users/alice/cache/app.dmg", version: "v1", assetUrl: "https://host/file",
    token: "DO-NOT-EXPORT", downloadedSha256: "cached-hash" };
  const values = { "updainium.sources.v1": JSON.stringify([source]), "updainium.background.v1": "true", "github-token": "DO-NOT-EXPORT" };
  const backup = createBackup({ getItem: (key) => values[key] ?? null }, true);
  const text = JSON.stringify(backup);
  assert.equal(backup.settings.startOnLogin, true);
  assert.equal(backup.sources[0].appIdentifier, "org.app");
  assert.equal(backup.sources[0].assetExtension, ".dmg");
  for (const forbidden of ["DO-NOT-EXPORT", "downloadPath", "cached-hash", "assetUrl", '"version":"v1"']) {
    assert.ok(!text.includes(forbidden));
  }
  assert.deepEqual(parseBackup(text), backup);
});

test("rejects unsupported, malformed, duplicate, and oversized backups", () => {
  const invalid = [
    { ...fixture(), version: 2 },
    { ...fixture(), format: "other" },
    { ...fixture(), settings: { backgroundEnabled: "true", startOnLogin: false } },
    { ...fixture(), sources: [null] },
    { ...fixture(), sources: [{ ...fixture().sources[0], url: "http://github.com/owner/app" }] },
    { ...fixture(), sources: [{ ...fixture().sources[0], url: "https://token@github.com/owner/app" }] },
    { ...fixture(), sources: [{ ...fixture().sources[0], assetArchitecture: "bad" }] },
    { ...fixture(), sources: [{ ...fixture().sources[0], appIdentifier: 42 }] },
    { ...fixture(), sources: [...fixture().sources, ...fixture().sources] },
    { ...fixture(), sources: Array.from({ length: maxBackupSources + 1 }, (_, i) => ({
      id: `app-${i}`, repo: `owner/app-${i}`, url: `https://github.com/owner/app-${i}`,
    })) },
  ];
  for (const value of invalid) assert.throws(() => parseBackup(JSON.stringify(value)));
  assert.throws(() => parseBackup("{broken"));
  assert.throws(() => parseBackup("x".repeat(maxBackupBytes + 1)), /5 MB/);
  assert.throws(() => parseBackup(JSON.stringify({
    ...fixture(),
    sources: Array.from({ length: maxBackupSources + 1 }, (_, i) => ({
      id: `app-${i}`, repo: `owner/app-${i}`, url: `https://github.com/owner/app-${i}`,
    })),
  })), new RegExp(String(maxBackupSources)));
  assert.equal(parseBackup(JSON.stringify({
    ...fixture(),
    sources: Array.from({ length: maxBackupSources }, (_, i) => ({
      id: `app-${i}`, repo: `owner/app-${i}`, url: `https://github.com/owner/app-${i}`,
    })),
  })).sources.length, maxBackupSources);
});

test("imported unknown OAuth and token fields never reach restored settings", () => {
  const incoming = { ...fixture(), oauth: { access_token: "private", refresh_token: "private-refresh" },
    settings: { ...fixture().settings, githubToken: "private" },
    sources: [{ ...fixture().sources[0], device_code: "private-code", downloadPath: "/old/machine" }] };
  const parsed = parseBackup(JSON.stringify(incoming));
  const restored = restoreSources(parsed, [], "replace");
  const output = JSON.stringify({ parsed, restored });
  assert.ok(!output.includes("private"));
  assert.ok(!output.includes("downloadPath"));
  assert.deepEqual(parsed.settings, fixture().settings);
});

test("merge keeps existing app details, skips matching URLs, and resolves ID collisions", () => {
  const backup = parseBackup(JSON.stringify(fixture()));
  const existing = [{ id: "different-id", url: backup.sources[0].url, version: "v2", downloadPath: "/local/file" }];
  assert.deepEqual(restoreSources(backup, existing, "merge"), existing);
  const collision = [{ id: "app-1", url: "https://github.com/other/app", version: "v3" }];
  const merged = restoreSources(backup, collision, "merge");
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], collision[0]);
  assert.notEqual(merged[1].id, "app-1");
  assert.equal(merged[1].url, backup.sources[0].url);
  assert.equal(backup.sources[0].id, "app-1");
});

test("replace discards old apps and restores fields accepted by the app catalog", () => {
  const backup = parseBackup(JSON.stringify(fixture()));
  const restored = restoreSources(backup, [{ id: "old", url: "https://host/other/app" }], "replace");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "app-1");
  for (const key of ["version", "assetName", "assetUrl", "checkedAt", "error"]) assert.equal(restored[0][key], "");
  assert.deepEqual(restoreSources({ ...backup, sources: [] }, restored, "replace"), []);
  assert.throws(() => restoreSources(backup, [null], "merge"), /local app catalog/);
});
