import test from "node:test";
import assert from "node:assert/strict";
import { downloadAndOpenFlow, createDownloadManager } from "../src/lib/downloadFlow.ts";

const source = {
  id: "source-1",
  repo: "github.com/owner/repo",
  url: "https://github.com/owner/repo",
  version: "1.2.3",
  assetName: "app-1.2.3.msi",
  assetUrl: "https://host/app.msi",
  checkedAt: "2026-11-16T00:00:00.000Z",
  error: "",
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

test("downloadAndOpenFlow downloads and opens the installer", async () => {
  const calls = [];
  const opened = [];
  const progress = [];

  const result = await downloadAndOpenFlow(source, {
    invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === "download_release_asset_resilient") {
        return { path: "/tmp/app.msi", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", verified: true };
      }
      throw new Error(`unexpected command ${command}`);
    },
    openPath: async (path) => {
      opened.push(path);
    },
    onProgress: (event) => progress.push(event.phase),
  });

  assert.equal(result.ok, true);
  assert.equal(result.source.downloadPath, "/tmp/app.msi");
  assert.equal(result.source.hashVerified, true);
  assert.deepEqual(opened, ["/tmp/app.msi"]);
  assert.deepEqual(progress, ["downloading", "opening"]);
  assert.equal(calls.length, 1);
});

test("downloadAndOpenFlow prepares and quits a running app before downloading", async () => {
  const runningSource = { ...source, appIdentifier: "com.owner.app" };
  const commands = [];

  const result = await downloadAndOpenFlow(runningSource, {
    invoke: async (command, args) => {
      commands.push(command);
      if (command === "get_running_app_state") {
        return { running: true, launchPath: "/Applications/Repo.app", isSelf: false };
      }
      if (command === "quit_running_app") {
        return true;
      }
      if (command === "download_release_asset_resilient") {
        return { path: "/tmp/app.msi", sha256: source.sha256, verified: true };
      }
      throw new Error(`unexpected ${command}`);
    },
    openPath: async () => {},
    saveResumeSession: () => {},
  });

  assert.equal(result.ok, true);
  assert.deepEqual(commands, ["get_running_app_state", "quit_running_app", "download_release_asset_resilient"]);
});

test("downloadAndOpenFlow records a SHA-256 mismatch and does not open the installer", async () => {
  const opened = [];
  const result = await downloadAndOpenFlow(source, {
    invoke: async (command) => {
      if (command === "download_release_asset_resilient") {
        throw new Error("The downloaded file failed SHA-256 verification. Expected aaaa, got bbbb.");
      }
      throw new Error(`unexpected ${command}`);
    },
    openPath: async (path) => {
      opened.push(path);
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Could not download the installer/);
  assert.equal(result.source.hashVerified, undefined);
  assert.deepEqual(opened, []);
});

test("downloadAndOpenFlow refuses to update Updainium itself automatically", async () => {
  const selfSource = { ...source, appIdentifier: "com.livrasand.updainium" };
  const result = await downloadAndOpenFlow(selfSource, {
    invoke: async (command) => {
      if (command === "get_running_app_state") {
        return { running: true, launchPath: null, isSelf: true };
      }
      throw new Error(`unexpected ${command}`);
    },
    openPath: async () => {},
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /stays manual/);
});

test("downloadAndOpenFlow requires an asset URL", async () => {
  const result = await downloadAndOpenFlow({ ...source, assetUrl: "" }, {
    invoke: async () => {
      throw new Error("should not be called");
    },
    openPath: async () => {},
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no downloadable release asset/);
});

test("DownloadManager pauses and resumes downloads", async () => {
  const manager = createDownloadManager({
    invoke: async (command) => {
      if (command === "pause_download" || command === "resume_download" || command === "cancel_download") {
        return undefined;
      }
      throw new Error(`unexpected ${command}`);
    },
    openPath: async () => {},
  });

  const states = [];
  const unsub = manager.onStatusChange((id, status) => states.push(status));

  await manager.pause("source-1");
  assert.equal(manager.getState("source-1").status, "paused");
  assert.deepEqual(states, ["paused"]);

  await manager.resume("source-1");
  assert.equal(manager.getState("source-1").status, "downloading");
  assert.deepEqual(states, ["paused", "downloading"]);

  await manager.cancel("source-1");
  assert.equal(manager.getState("source-1").status, "idle");
  assert.deepEqual(states, ["paused", "downloading", "cancelling", "idle"]);

  unsub();
});
