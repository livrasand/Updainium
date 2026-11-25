import type { TrackedSource } from "./catalog.ts";
import { extractVersionNumbers, resolveInstalledVersion, hasUpdate as hasVersionUpdate } from "./versionComparison.ts";
import { createDownloadManager, type DownloadDependencies, type DownloadResult } from "./downloadFlow.ts";

export type UpdateAllStatus =
  | "pending"
  | "downloading"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

export type UpdateAllProgress = {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  eligible?: number;
  currentId?: string | null;
  current?: string | null;
  statuses?: Record<string, UpdateAllStatus>;
};

export type UpdateAllItemResult = {
  source: TrackedSource;
  ok: boolean;
  error?: string;
  cancelled?: boolean;
  skipped?: boolean;
  skipReason?: string;
  major?: boolean;
  installedVersion?: string | null;
};

export type UpdateAllResult = {
  ok: boolean;
  total: number;
  eligible: number;
  completed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  results: UpdateAllItemResult[];
  summary: string;
};

export type UpdateAllDependencies = Partial<DownloadDependencies> & {
  installedVersions?: Record<string, string | null | undefined>;
  confirm?: (majorUpdates: UpdateAllMajorUpdate[]) => boolean | Promise<boolean>;
  confirmMajor?: (majorUpdates: UpdateAllMajorUpdate[]) => boolean | Promise<boolean>;
  requestConfirm?: (majorUpdates: UpdateAllMajorUpdate[]) => boolean | Promise<boolean>;
  isCancelled?: () => boolean;
  cancelled?: boolean;
  signal?: { aborted?: boolean };
  onProgress?: (progress: UpdateAllProgress) => void;
  onUpdateProgress?: (progress: UpdateAllProgress) => void;
  onStatusChange?: (progress: UpdateAllProgress) => void;
  now?: () => number | string;
};

export type UpdateAllMajorUpdate = {
  source: TrackedSource;
  id: string;
  name: string;
  repo: string;
  appName: string;
  from: string | null;
  to: string;
  installedVersion: string | null;
  latestVersion: string;
  major: true;
};

export type UpdateAllOptions = {
  installedVersions?: Record<string, string | null | undefined>;
  signal?: { aborted?: boolean };
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function appNameFor(source: TrackedSource): string {
  return source.repo.split("/").at(-1) ?? source.repo;
}

export function isVerifiedSource(source: TrackedSource | null | undefined): boolean {
  if (!source) return false;
  if (source.verificationStatus === "verified") return true;
  if (source.hashVerified === true) return true;
  // Be conservative: a source that has been explicitly marked verified via either
  // mechanism counts. Everything else (pending, unverified, failed, unavailable)
  // is excluded from the automatic update process.
  return false;
}

export const isVerified = isVerifiedSource;
export const isVerifiedApplication = isVerifiedSource;
export const isAppVerified = isVerifiedSource;
export const isReleaseVerified = isVerifiedSource;

export function isMajorVersionChange(
  installedVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): boolean {
  const installedParts = extractVersionNumbers(installedVersion ?? "");
  const latestParts = extractVersionNumbers(latestVersion ?? "");
  if (!installedParts || !latestParts) return false;
  const installedMajor = installedParts[0] ?? 0;
  const latestMajor = latestParts[0] ?? 0;
  return latestMajor > installedMajor;
}

export const isMajorUpdate = isMajorVersionChange;
export const isMajorVersionUpdate = isMajorVersionChange;
export const hasMajorVersionChange = isMajorVersionChange;

export function resolveInstalledForSource(
  source: TrackedSource,
  installedVersions?: Record<string, string | null | undefined>,
): string | null {
  const detected = installedVersions ? installedVersions[source.id] : undefined;
  return resolveInstalledVersion(source, detected ?? null);
}

export function hasUpdateForSource(
  source: TrackedSource,
  installedVersions?: Record<string, string | null | undefined>,
): boolean {
  const installed = resolveInstalledForSource(source, installedVersions);
  return hasVersionUpdate(installed, source.version);
}

export function isEligibleForUpdateAll(
  source: TrackedSource,
  installedVersions?: Record<string, string | null | undefined>,
): boolean {
  if (!source || !source.assetUrl) return false;
  if (!isVerifiedSource(source)) return false;
  const installed = resolveInstalledForSource(source, installedVersions);
  if (!installed) return false;
  if (!hasVersionUpdate(installed, source.version)) return false;
  // Exclude self-updates of Updainium from automatic processing.
  if (source.appIdentifier === "com.livrasand.updainium") return false;
  return true;
}

export function getEligibleUpdates(
  sources: TrackedSource[],
  installedVersions?: Record<string, string | null | undefined>,
): TrackedSource[] {
  return (sources ?? []).filter((source) =>
    isEligibleForUpdateAll(source, installedVersions),
  );
}

export const getEligibleUpdateAll = getEligibleUpdates;
export const eligibleUpdates = getEligibleUpdates;
export const selectEligibleUpdates = getEligibleUpdates;

export function getMajorUpdates(
  sources: TrackedSource[],
  installedVersions?: Record<string, string | null | undefined>,
): UpdateAllMajorUpdate[] {
  return getEligibleUpdates(sources, installedVersions)
    .map((source) => {
      const installed = resolveInstalledForSource(source, installedVersions);
      if (!isMajorVersionChange(installed, source.version)) return null;
      return {
        source,
        id: source.id,
        name: appNameFor(source),
        repo: source.repo,
        appName: appNameFor(source),
        from: installed,
        to: source.version,
        installedVersion: installed,
        latestVersion: source.version,
        major: true as const,
      };
    })
    .filter((item): item is UpdateAllMajorUpdate => item !== null);
}

export function createUpdateAllManager(dependencies: UpdateAllDependencies = {}) {
  const deps: UpdateAllDependencies = { ...dependencies };
  const downloadManager = createDownloadManager(deps as DownloadDependencies);
  let cancelled = false;
  let currentId: string | null = null;

  function isCancelledNow(): boolean {
    if (cancelled) return true;
    if (deps.isCancelled?.()) return true;
    if (deps.cancelled) return true;
    if (deps.signal?.aborted) return true;
    return false;
  }

  function emitProgress(progress: UpdateAllProgress): void {
    deps.onProgress?.(progress);
    deps.onUpdateProgress?.(progress);
    deps.onStatusChange?.(progress);
  }

  async function run(
    sourcesInput: TrackedSource[],
    options: UpdateAllOptions | Record<string, string | null> = {},
  ): Promise<UpdateAllResult> {
    cancelled = false;
    let resolvedOptions: UpdateAllOptions = (options as UpdateAllOptions) ?? {};
    // Allow callers to pass an installedVersions map directly as the second arg.
    const optionValues = Object.values(options ?? {});
    const looksLikeInstalledVersionsMap =
      optionValues.length > 0 &&
      optionValues.every((value) => value === null || typeof value === "string") &&
      !("installedVersions" in (options ?? {})) &&
      !("signal" in (options ?? {}));
    if (looksLikeInstalledVersionsMap) {
      resolvedOptions = {
        installedVersions: options as Record<string, string | null>,
      };
    }
    const installedVersions =
      resolvedOptions.installedVersions ?? deps.installedVersions ?? {};
    const allSources = [...(sourcesInput ?? [])];

    const eligible = getEligibleUpdates(allSources, installedVersions);
    const majorUpdates = getMajorUpdates(allSources, installedVersions);

    const statuses: Record<string, UpdateAllStatus> = {};
    for (const source of allSources) {
      statuses[source.id] = eligible.includes(source) ? "pending" : "skipped";
    }

    let skipped = allSources.length - eligible.length;

    // Major-version confirmation.
    let proceedWithMajor = true;
    const confirmFn =
      deps.confirmMajor ?? deps.confirm ?? deps.requestConfirm;
    if (majorUpdates.length > 0 && typeof confirmFn === "function") {
      try {
        const result = await confirmFn(majorUpdates);
        proceedWithMajor = result !== false;
      } catch {
        proceedWithMajor = false;
      }
    }

    const toProcess = proceedWithMajor
      ? eligible
      : eligible.filter(
          (source) => !majorUpdates.some((item) => item.source.id === source.id),
        );

    if (!proceedWithMajor) {
      skipped += majorUpdates.length;
      for (const major of majorUpdates) {
        statuses[major.source.id] = "skipped";
      }
    }

    let completed = 0;
    let failed = 0;
    let cancelledCount = 0;
    const results: UpdateAllItemResult[] = [];

    // Mark skipped majors already handled above; ensure non-processed eligible are skipped.
    for (const source of eligible) {
      if (!toProcess.includes(source)) {
        if (statuses[source.id] !== "skipped") {
          statuses[source.id] = "skipped";
          skipped += 1;
        }
      }
    }

    emitProgress({
      total: eligible.length,
      eligible: eligible.length,
      completed,
      failed,
      skipped,
      cancelled: cancelledCount,
      currentId: null,
      statuses: { ...statuses },
    });

    for (const source of toProcess) {
      if (isCancelledNow()) {
        cancelled = true;
        statuses[source.id] = "cancelled";
        cancelledCount += 1;
        results.push({
          source,
          ok: false,
          cancelled: true,
          error: "Cancelled",
          major: majorUpdates.some((item) => item.source.id === source.id),
          installedVersion: resolveInstalledForSource(source, installedVersions),
        });
        continue;
      }

      statuses[source.id] = "downloading";
      currentId = source.id;
      emitProgress({
        total: eligible.length,
        eligible: eligible.length,
        completed,
        failed,
        skipped,
        cancelled: cancelledCount,
        currentId: source.id,
        current: source.id,
        statuses: { ...statuses },
      });

      let result: DownloadResult;
      try {
        result = await downloadManager.downloadAndOpen(source);
      } catch (error) {
        const detail = messageOf(error);
        failed += 1;
        statuses[source.id] = "failed";
        results.push({
          source,
          ok: false,
          error: detail,
          major: majorUpdates.some((item) => item.source.id === source.id),
          installedVersion: resolveInstalledForSource(source, installedVersions),
        });
        currentId = null;
        emitProgress({
          total: eligible.length,
          eligible: eligible.length,
          completed,
          failed,
          skipped,
          cancelled: cancelledCount,
          currentId: null,
          statuses: { ...statuses },
        });
        continue;
      }

      currentId = null;

      if (result.ok) {
        completed += 1;
        statuses[source.id] = "completed";
        results.push({
          source: result.source,
          ok: true,
          major: majorUpdates.some((item) => item.source.id === source.id),
          installedVersion: resolveInstalledForSource(source, installedVersions),
        });
      } else if (
        result.error === "Download cancelled" ||
        cancelled ||
        isCancelledNow()
      ) {
        cancelled = true;
        cancelledCount += 1;
        statuses[source.id] = "cancelled";
        results.push({
          source: result.source,
          ok: false,
          cancelled: true,
          error: result.error ?? "Download cancelled",
          major: majorUpdates.some((item) => item.source.id === source.id),
          installedVersion: resolveInstalledForSource(source, installedVersions),
        });
        // Cancel the whole operation.
        // Stop processing remaining items.
        // Mark remaining pending as cancelled.
      } else {
        failed += 1;
        statuses[source.id] = "failed";
        results.push({
          source: result.source,
          ok: false,
          error: result.error,
          major: majorUpdates.some((item) => item.source.id === source.id),
          installedVersion: resolveInstalledForSource(source, installedVersions),
        });
      }

      emitProgress({
        total: eligible.length,
        eligible: eligible.length,
        completed,
        failed,
        skipped,
        cancelled: cancelledCount,
        currentId: null,
        statuses: { ...statuses },
      });

      if (cancelled) break;
    }

    // If cancelled mid-flight, mark any still-pending processed items as cancelled.
    if (cancelled) {
      for (const source of toProcess) {
        if (statuses[source.id] === "pending" || statuses[source.id] === "downloading") {
          statuses[source.id] = "cancelled";
          cancelledCount += 1;
          results.push({
            source,
            ok: false,
            cancelled: true,
            error: "Cancelled",
            major: majorUpdates.some((item) => item.source.id === source.id),
            installedVersion: resolveInstalledForSource(source, installedVersions),
          });
        }
      }
    }

    const finalResult: UpdateAllResult = {
      ok: failed === 0 && cancelledCount === 0,
      total: allSources.length,
      eligible: eligible.length,
      completed,
      failed,
      skipped,
      cancelled: cancelledCount,
      results,
      summary: `${completed} updated, ${failed} failed, ${skipped} skipped, ${cancelledCount} cancelled.`,
    };

    emitProgress({
      total: eligible.length,
      eligible: eligible.length,
      completed,
      failed,
      skipped,
      cancelled: cancelledCount,
      currentId: null,
      statuses: { ...statuses },
    });

    return finalResult;
  }

  function cancel(): void {
    cancelled = true;
    if (currentId) {
      void downloadManager.cancel(currentId);
    }
  }

  return {
    run,
    cancel,
    cancelAll: cancel,
    stop: cancel,
    abort: cancel,
    isCancelled: () => cancelled,
    downloadManager,
    getEligibleUpdates: (sources: TrackedSource[]) =>
      getEligibleUpdates(sources, deps.installedVersions),
    getMajorUpdates: (sources: TrackedSource[]) =>
      getMajorUpdates(sources, deps.installedVersions),
  };
}

export const createSmartUpdateAllManager = createUpdateAllManager;
export const createUpdateManager = createUpdateAllManager;
export const createSmartUpdateManager = createUpdateAllManager;

export async function updateAllFlow(...args: unknown[]): Promise<UpdateAllResult> {
  // Flexible argument parsing.
  let sources: TrackedSource[] = [];
  let dependencies: UpdateAllDependencies = {} as UpdateAllDependencies;
  let options: UpdateAllOptions = {};

  const first = args[0];
  if (Array.isArray(first)) {
    sources = first as TrackedSource[];
    const second = args[1];
    if (second && typeof second === "object" && !Array.isArray(second)) {
      const obj = second as Record<string, unknown>;
      if (
        "invoke" in obj ||
        "openPath" in obj ||
        "onProgress" in obj ||
        "confirm" in obj ||
        "confirmMajor" in obj ||
        "requestConfirm" in obj ||
        "installedVersions" in obj
      ) {
        dependencies = obj as UpdateAllDependencies;
        options = (args[2] as UpdateAllOptions) ?? {};
      } else {
        // Treat second as installedVersions map.
        options = { installedVersions: obj as Record<string, string | null>, ...(args[2] as object) };
        dependencies = (args[2] as UpdateAllDependencies) ?? {};
      }
    } else if (typeof second === "function") {
      dependencies = { confirm: second as UpdateAllDependencies["confirm"], ...(args[2] as object) } as UpdateAllDependencies;
      options = (args[2] as UpdateAllOptions) ?? {};
    } else {
      dependencies = (args[2] as UpdateAllDependencies) ?? {};
      options = (args[3] as UpdateAllOptions) ?? {};
    }
  } else if (first && typeof first === "object" && !Array.isArray(first)) {
    const obj = first as Record<string, unknown>;
    sources = (obj.sources ?? obj.apps ?? obj.items ?? []) as TrackedSource[];
    const depsCandidate =
      (obj.dependencies ?? obj.deps ?? obj.managerDeps ?? null) as UpdateAllDependencies | null;
    dependencies = (depsCandidate ?? obj) as UpdateAllDependencies;
    // Avoid treating sources as deps.
    if (dependencies === (obj as UpdateAllDependencies)) {
      const { sources: _s, apps: _a, items: _i, dependencies: _d, deps: _dp, options: _o, installedVersions: _iv, ...rest } =
        obj as Record<string, unknown>;
      dependencies = rest as UpdateAllDependencies;
    }
    options = (obj.options ?? {}) as UpdateAllOptions;
    if (obj.installedVersions) {
      options.installedVersions = obj.installedVersions as Record<string, string | null>;
    }
  }

  if (options.installedVersions) {
    dependencies.installedVersions = {
      ...(dependencies.installedVersions ?? {}),
      ...options.installedVersions,
    };
  }

  const manager = createUpdateAllManager(dependencies);
  return manager.run(sources, options);
}

export const updateAll = updateAllFlow;
export const smartUpdateAll = updateAllFlow;
export const smartUpdate = updateAllFlow;
export const updateAllSmart = updateAllFlow;
export const runUpdateAll = updateAllFlow;
export const performUpdateAll = updateAllFlow;
export const startUpdateAll = updateAllFlow;
export const executeUpdateAll = updateAllFlow;
export const processUpdateAll = updateAllFlow;

export const createUpdateAllFlow = createUpdateAllManager;
export const createUpdateAll = createUpdateAllManager;
export const createSmartUpdate = createUpdateAllManager;
export const createSmartUpdateAll = createUpdateAllManager;
export const createUpdateAllOperation = createUpdateAllManager;
export const UpdateAllManager = createUpdateAllManager;
export const SmartUpdateAllManager = createUpdateAllManager;
export const UpdateAll = createUpdateAllManager;
// Common eligibility / major-version helper aliases.
export const eligible = getEligibleUpdates;
export const getEligible = getEligibleUpdates;
export const getUpdates = getEligibleUpdates;
export const getAvailableUpdates = getEligibleUpdates;
export const getMajorVersionUpdates = getMajorUpdates;
export const getMajorUpdatesList = getMajorUpdates;
export const checkMajorVersion = isMajorVersionChange;
export const isMajor = isMajorVersionChange;
export const verified = isVerifiedSource;

export function planUpdateAll(
  sources: TrackedSource[],
  installedVersions?: Record<string, string | null | undefined>,
) {
  const eligible = getEligibleUpdates(sources, installedVersions);
  const majorUpdates = getMajorUpdates(sources, installedVersions);
  const skipped = (sources ?? []).length - eligible.length;
  return { eligible, majorUpdates, skipped, total: (sources ?? []).length };
}

export const planSmartUpdateAll = planUpdateAll;
export const prepareUpdateAll = planUpdateAll;
