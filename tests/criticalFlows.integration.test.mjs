import test from "node:test";
import assert from "node:assert/strict";
import { buildTrackedSource } from "../src/lib/sourceValidation.ts";
import { checkSourceFlow } from "../src/lib/releaseCheck.ts";
import { downloadAndOpenFlow } from "../src/lib/downloadFlow.ts";
import { hasUpdate, resolveInstalledVersion } from "../src/lib/versionComparison.ts";

test("critical flow: add app, check update, download, and open installer", async () => {
  // 1. Add app.
  const tracked = buildTrackedSource(
    { url: "https://github.com/owner/repo", appIdentifier: "com.owner.repo" },
    [],
  );
  assert.equal(tracked.repo, "github.com/owner/repo");
  assert.equal(tracked.version, "");

  // 2. Check for an update.
  const checked = await checkSourceFlow(tracked, { os: "linux", arch: "x86_64" }, {
    fetchReleaseMetadata: async () => ({
      tag_name: "v2.0.0",
      published_at: "2026-11-16T00:00:00.000Z",
      body: "New release",
      assets: [
        { name: "repo-2.0.0-x86_64.AppImage", browser_download_url: "https://host/repo.AppImage", digest: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
      ],
    }),
    now: () => "2026-11-17T00:00:00.000Z",
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.source.version, "v2.0.0");
  assert.equal(checked.source.assetUrl, "https://host/repo.AppImage");

  // Simulate an older installed version to make the update visible.
  const installedSource = {
    ...checked.source,
    lastKnownInstalledVersion: "1.0.0",
    installedVersionSource: "manual",
  };
  const installedVersion = resolveInstalledVersion(installedSource, null);
  assert.equal(hasUpdate(installedVersion, installedSource.version), true);

  // 3. Download and 4. open/install the installer.
  const opened = [];
  const downloaded = await downloadAndOpenFlow(installedSource, {
    invoke: async (command) => {
      if (command === "get_running_app_state") return { running: false, launchPath: null, isSelf: false };
      if (command === "download_release_asset_resilient") {
        return {
          path: "/cache/repo-2.0.0.AppImage",
          sha256: "1111111111111111111111111111111111111111111111111111111111111111",
          verified: true,
        };
      }
      throw new Error(`unexpected ${command}`);
    },
    openPath: async (path) => {
      opened.push(path);
    },
  });

  assert.equal(downloaded.ok, true);
  assert.equal(downloaded.source.downloadPath, "/cache/repo-2.0.0.AppImage");
  assert.equal(downloaded.source.hashVerified, true);
  assert.deepEqual(opened, ["/cache/repo-2.0.0.AppImage"]);
});
