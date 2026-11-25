import type { TrackedSource } from "./catalog.ts";

export type DownloadProgress = {
  downloadId: string;
  phase: "closing" | "downloading" | "verifying" | "opening" | "paused";
  received: number;
  total: number | null;
};

export type DownloadStatus = "idle" | "downloading" | "paused" | "cancelling" | "completed" | "error";

export type DownloadState = {
  status: DownloadStatus;
  received: number;
  total: number | null;
  error?: string;
  retryCount: number;
};

export type DownloadDependencies = {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
  openPath: (path: string) => Promise<void>;
  onProgress?: (progress: DownloadProgress) => void;
  onStatusChange?: (downloadId: string, status: DownloadStatus) => void;
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

const MAX_RETRIES = 5;

function backoffDelay(attempt: number): number {
  return Math.min(500 * 2 ** Math.min(attempt, 6), 30_000);
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancelled|timed out|network|connection|ECONNRESET|ETIMEDOUT|ENETUNREACH|5\d\d/.test(message);
}

function appNameFor(source: TrackedSource): string {
  return source.repo.split("/").at(-1) ?? source.repo;
}

export function createDownloadManager(dependencies: DownloadDependencies) {
  const states = new Map<string, DownloadState>();
  const listeners = new Set<(downloadId: string, status: DownloadStatus) => void>();

  function getState(downloadId: string): DownloadState {
    return (
      states.get(downloadId) ?? {
        status: "idle",
        received: 0,
        total: null,
        retryCount: 0,
      }
    );
  }

  function getAllStates(): Map<string, DownloadState> {
    return new Map(states);
  }

  function setState(downloadId: string, partial: Partial<DownloadState>): void {
    const current = getState(downloadId);
    const next: DownloadState = { ...current, ...partial };
    states.set(downloadId, next);
    if (partial.status) {
      listeners.forEach((listener) => listener(downloadId, next.status));
    }
  }

  function onStatusChange(listener: (downloadId: string, status: DownloadStatus) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function prepareUpdateSession(source: TrackedSource): Promise<{ ok: true; session: { wasRunning: boolean; targetVersion: string; launchPath?: string; savedAt: number } | null } | { ok: false; message: string }> {
    const appName = appNameFor(source);
    const baseSession = {
      wasRunning: false,
      targetVersion: source.version,
      savedAt: (dependencies.now ?? (() => Date.now()))(),
    };
    if (!source.appIdentifier) return { ok: true, session: null };
    try {
      const state = await dependencies.invoke<{
        running: boolean;
        launchPath?: string | null;
        isSelf: boolean;
      }>("get_running_app_state", {
        appName,
        appIdentifier: source.appIdentifier,
      });
      if (state.isSelf) {
        return {
          ok: false,
          message: "Updating Updainium itself stays manual: close Updainium before completing the installer.",
        };
      }
      if (!state.running) return { ok: true, session: null };
      const exited = await dependencies.invoke<boolean>("quit_running_app", {
        appName,
        appIdentifier: source.appIdentifier,
      });
      if (!exited) {
        return {
          ok: false,
          message: `Could not update ${appName}: it is still running after a graceful close request. Close ${appName} manually and try again.`,
        };
      }
      return {
        ok: true,
        session: { ...baseSession, wasRunning: true, launchPath: state.launchPath ?? undefined },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Could not check whether ${appName} is running: ${message}`,
      };
    }
  }

  async function downloadAndOpen(source: TrackedSource): Promise<DownloadResult> {
    if (!source.assetUrl) {
      return { source, ok: false, error: "This app has no downloadable release asset." };
    }

    setState(source.id, { status: "downloading", received: 0, total: null, retryCount: 0 });

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

    if (working.appIdentifier) {
      try {
        const prepared = await prepareUpdateSession(working);
        if (!prepared.ok) {
          setState(source.id, { status: "error", error: prepared.message });
          return { source: { ...working, error: prepared.message }, ok: false, error: prepared.message };
        }
        if (prepared.session) {
          dependencies.saveResumeSession?.(working, prepared.session);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = `Could not check whether ${appNameFor(working)} is running: ${message}`;
        setState(source.id, { status: "error", error: detail });
        return { source: { ...working, error: detail }, ok: false, error: detail };
      }
    }

    dependencies.onProgress?.({
      downloadId: source.id,
      phase: "downloading",
      received: 0,
      total: null,
    });

    let lastError: unknown = null;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      const state = getState(source.id);
      if (state.status === "cancelling") {
        setState(source.id, { status: "idle", error: "Download cancelled" });
        return { source: { ...working, error: "Download cancelled" }, ok: false, error: "Download cancelled" };
      }

      while (getState(source.id).status === "paused") {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const updated = getState(source.id);
        if (updated.status === "cancelling") {
          setState(source.id, { status: "idle", error: "Download cancelled" });
          return { source: { ...working, error: "Download cancelled" }, ok: false, error: "Download cancelled" };
        }
        if (updated.status !== "paused") break;
      }

      try {
        const downloaded = await dependencies.invoke<{
          path: string;
          sha256: string;
          verified: boolean;
        }>("download_release_asset_resilient", {
          url: working.assetUrl,
          fileName: working.assetName,
          expectedSha256: working.sha256 ?? null,
          downloadId: working.id,
          maxRetries: MAX_RETRIES,
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

        const completedState = getState(source.id);
        setState(source.id, { status: "completed", received: completedState.total ?? 0, total: completedState.total });

        await dependencies.openPath(downloaded.path);
        return { source: working, ok: true };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);

        if (message === "Download cancelled") {
          setState(source.id, { status: "idle", error: undefined });
          return { source: { ...working, error: "Download cancelled" }, ok: false, error: "Download cancelled" };
        }

        retryCount += 1;
        setState(source.id, { retryCount });

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
          setState(source.id, { status: "error", error: message });
          return {
            source: { ...working, error: message },
            ok: false,
            error: message,
          };
        }

        if (!isRetryableError(error) || retryCount > MAX_RETRIES) {
          const downloadedPath = working.downloadPath;
          const detail = downloadedPath
            ? `The installer downloaded, but it could not be opened (${downloadedPath}): ${message}`
            : `Could not download the installer: ${message}`;
          setState(source.id, { status: "error", error: detail });
          return {
            source: { ...working, error: detail },
            ok: false,
            error: detail,
          };
        }

        const delay = backoffDelay(retryCount);
        setState(source.id, { status: "downloading", error: `Retry ${retryCount}/${MAX_RETRIES} after ${Math.round(delay / 1000)}s: ${message}` });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    const detail = `Could not download the installer after ${MAX_RETRIES} attempts: ${message}`;
    setState(source.id, { status: "error", error: detail });
    return { source: { ...working, error: detail }, ok: false, error: detail };
  }

  async function pause(downloadId: string): Promise<void> {
    setState(downloadId, { status: "paused" });
    try {
      await dependencies.invoke("pause_download", { downloadId });
    } catch {
      // Ignore pause errors; local state is authoritative
    }
  }

  async function resume(downloadId: string): Promise<void> {
    setState(downloadId, { status: "downloading" });
    try {
      await dependencies.invoke("resume_download", { downloadId });
    } catch {
      // Ignore resume errors; local state is authoritative
    }
  }

  async function cancel(downloadId: string): Promise<void> {
    setState(downloadId, { status: "cancelling" });
    try {
      await dependencies.invoke("cancel_download", { downloadId });
    } catch {
      // Ignore cancel errors; local state is authoritative
    }
    setState(downloadId, { status: "idle" });
  }

  return {
    getState,
    getAllStates,
    setState,
    onStatusChange,
    downloadAndOpen,
    pause,
    resume,
    cancel,
  };
}

export async function downloadAndOpenFlow(
  source: TrackedSource,
  dependencies: DownloadDependencies,
): Promise<DownloadResult> {
  const manager = createDownloadManager(dependencies);
  return manager.downloadAndOpen(source);
}
