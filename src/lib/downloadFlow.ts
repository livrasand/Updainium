import type { TrackedSource } from "./catalog.ts";

export type DownloadProgress = {
  downloadId: string;
  phase: "closing" | "downloading" | "verifying" | "opening";
  received: number;
  total: number | null;
};

export type DownloadDependencies = {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  openPath: (path: string) => Promise<void>;
  onProgress?: (progress: DownloadProgress) => void;
  saveResumeSession?: (source: TrackedSource, session: {
    wasRunning: boolean;
    targetVersion: string;
    launchPath?: string;
    savedAt: number;
  }) => void;
  deleteResumeSession?: (sourceId: string) => void;
  now?: () => number;
};

export type DownloadResult = {
  source: TrackedSource;
  ok: boolean;
  error?: string;
};

function appNameFor(source: TrackedSource): string {
  return source.repo.split("/").at(-1) ?? source.repo;
}

export async function downloadAndOpenFlow(
  source: TrackedSource,
  dependencies: DownloadDependencies,
): Promise<DownloadResult> {
  if (!source.assetUrl) {
    return { source, ok: false, error: "This app has no downloadable release asset." };
  }

  const now = dependencies.now ?? (() => Date.now());
  let working: TrackedSource = {
    ...source,
    error: "",
    downloadPath: undefined,
    downloadedSha256: undefined,
    hashVerified: undefined,
    verificationStatus: source.verificationStatus,
    signatureStatus: source.signatureStatus,
  };
  dependencies.deleteResumeSession?.(source.id);

  // Prepare a running-app session before downloading, so the app can be
  // reopened after the installer finishes.
  if (working.appIdentifier) {
    try {
      const state = await dependencies.invoke<{
        running: boolean;
        launchPath?: string | null;
        isSelf: boolean;
      }>("get_running_app_state", {
        appName: appNameFor(working),
        appIdentifier: working.appIdentifier,
      });

      if (state.isSelf) {
        const message =
          "Updating Updainium itself stays manual: close Updainium before completing the installer.";
        return { source: { ...working, error: message }, ok: false, error: message };
      }

      if (state.running) {
        const exited = await dependencies.invoke<boolean>("quit_running_app", {
          appName: appNameFor(working),
          appIdentifier: working.appIdentifier,
        });
        if (!exited) {
          const message =
            `Could not update ${appNameFor(working)}: it is still running after a graceful close request, so the installer was not opened. Close ${appNameFor(working)} manually and try again.`;
          return { source: { ...working, error: message }, ok: false, error: message };
        }
        dependencies.saveResumeSession?.(working, {
          wasRunning: true,
          targetVersion: working.version,
          launchPath: state.launchPath ?? undefined,
          savedAt: now(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = `Could not check whether ${appNameFor(working)} is running: ${message}`;
      return { source: { ...working, error: detail }, ok: false, error: detail };
    }
  }

  dependencies.onProgress?.({
    downloadId: source.id,
    phase: "downloading",
    received: 0,
    total: null,
  });

  try {
    const downloaded = await dependencies.invoke<{
      path: string;
      sha256: string;
      verified: boolean;
    }>("download_release_asset", {
      url: working.assetUrl,
      fileName: working.assetName,
      expectedSha256: working.sha256 ?? null,
      downloadId: working.id,
    });

    dependencies.onProgress?.({
      downloadId: source.id,
      phase: "opening",
      received: 0,
      total: null,
    });

    working = {
      ...working,
      downloadPath: downloaded.path,
      downloadedSha256: downloaded.sha256,
      hashVerified: downloaded.verified,
      verificationStatus: downloaded.verified
        ? "verified"
        : working.sha256
          ? "failed"
          : "unavailable",
    };

    await dependencies.openPath(downloaded.path);
    return { source: working, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const verificationFailure = message.match(
      /failed SHA-256 verification\. Expected [a-f0-9]{64}, got ([a-f0-9]{64})\./i,
    );
    if (verificationFailure) {
      working = {
        ...working,
        downloadedSha256: verificationFailure[1],
        hashVerified: false,
        verificationStatus: "failed",
      };
    }
    const detail = working.downloadPath
      ? `The installer downloaded, but it could not be opened (${working.downloadPath}): ${message}`
      : `Could not download the installer: ${message}`;
    return { source: { ...working, error: detail }, ok: false, error: detail };
  }
}
