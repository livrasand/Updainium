import test from "node:test";
import assert from "node:assert/strict";
import { checkSourceFlow } from "../src/lib/releaseCheck.ts";

const source = {
  id: "source-1",
  repo: "github.com/owner/repo",
  url: "https://github.com/owner/repo",
  version: "",
  assetName: "",
  assetUrl: "",
  checkedAt: "",
  error: "",
};

const platform = { os: "linux", arch: "x86_64" };

test("checkSourceFlow updates a tracked source when a matching release exists", async () => {
  const releasePayload = {
    tag_name: "v1.2.3",
    published_at: "2026-11-16T00:00:00.000Z",
    body: "Release notes",
    assets: [
      { name: "app-1.2.3-x86_64.AppImage", browser_download_url: "https://host/app.AppImage", digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    ],
  };

  const result = await checkSourceFlow(source, platform, {
    fetchReleaseMetadata: async () => releasePayload,
    fetchRepositoryIcon: async () => "https://icon",
    now: () => "2026-11-17T00:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.source.version, "v1.2.3");
  assert.equal(result.source.assetName, "app-1.2.3-x86_64.AppImage");
  assert.equal(result.source.assetUrl, "https://host/app.AppImage");
  assert.equal(result.source.releaseNotes, "Release notes");
  assert.equal(result.source.iconUrl, "https://icon");
  assert.equal(result.source.error, "");
  assert.equal(result.source.checkedAt, "2026-11-17T00:00:00.000Z");
});

test("checkSourceFlow records a useful error when no compatible asset exists", async () => {
  const releasePayload = {
    tag_name: "v1.2.3",
    assets: [{ name: "app-1.2.3.dmg", browser_download_url: "https://host/app.dmg" }],
  };

  const result = await checkSourceFlow(source, platform, {
    fetchReleaseMetadata: async () => releasePayload,
    now: () => "2026-11-17T00:00:00.000Z",
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /No release asset matched/);
  assert.equal(result.source.checkedAt, "2026-11-17T00:00:00.000Z");
  assert.match(result.source.error, /No release asset matched/);
});

test("checkSourceFlow keeps going when icon lookup fails", async () => {
  const releasePayload = {
    tag_name: "v1.0.0",
    assets: [{ name: "tool-linux-x86_64", browser_download_url: "https://host/tool" }],
  };

  const result = await checkSourceFlow(source, platform, {
    fetchReleaseMetadata: async () => releasePayload,
    fetchRepositoryIcon: async () => {
      throw new Error("icon failed");
    },
    now: () => "2026-11-17T00:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.source.version, "v1.0.0");
  assert.equal(result.source.iconUrl, undefined);
});

test("checkSourceFlow records metadata fetch failures", async () => {
  const result = await checkSourceFlow(source, platform, {
    fetchReleaseMetadata: async () => {
      throw new Error("network down");
    },
    now: () => "2026-11-17T00:00:00.000Z",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "network down");
  assert.equal(result.source.error, "network down");
});
