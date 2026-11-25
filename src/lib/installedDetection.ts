import type { TrackedSource } from "./catalog.ts";
import { resolveInstalledVersion } from "./versionComparison.ts";

export type InstalledVersionOrigin = "detected" | "manual" | "upToDate" | "unknown";

export function getInstalledVersion(
  source: TrackedSource,
  detected: string | null | undefined,
): string | null {
  return resolveInstalledVersion(source, detected ?? null);
}

export function applyDetectedVersion(source: TrackedSource, version: string | null | undefined): TrackedSource {
  const normalized = (version ?? "").trim();
  if (!normalized) return source;
  if (source.installedVersionSource === "manual") return source;
  return {
    ...source,
    lastKnownInstalledVersion: normalized,
    installedVersionSource: "detected",
  };
}

export function applyManualVersion(source: TrackedSource, version: string): TrackedSource {
  const normalized = version.trim();
  if (!normalized) return source;
  return {
    ...source,
    lastKnownInstalledVersion: normalized,
    installedVersionSource: "manual",
  };
}

export function clearInstalledVersion(source: TrackedSource): TrackedSource {
  const { lastKnownInstalledVersion: _l, installedVersionSource: _s, ...rest } = source;
  return rest as TrackedSource;
}

export function markUpToDate(source: TrackedSource): TrackedSource {
  if (!source.version || source.version === "Unversioned release") return source;
  return {
    ...source,
    lastKnownInstalledVersion: source.version,
    installedVersionSource: "manual",
  };
}

export function installedVersionOrigin(
  source: TrackedSource,
  detected: string | null | undefined,
): InstalledVersionOrigin {
  if (source.installedVersionSource === "manual" && source.lastKnownInstalledVersion) return "manual";
  if (typeof detected === "string" && detected.trim()) return "detected";
  if (source.lastKnownInstalledVersion) return "manual";
  if (detected === null) return "unknown";
  return "unknown";
}

export function installedVersionStatus(
  source: TrackedSource,
  detected: string | null | undefined,
): InstalledVersionOrigin {
  const resolved = getInstalledVersion(source, detected);
  if (!resolved) return "unknown";
  if (source.installedVersionSource === "manual") return "manual";
  if (typeof detected === "string" && detected.trim()) return "detected";
  return "manual";
}

export type InstalledDetectionDependencies = {
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

export type InstalledDetectionResult = {
  source: TrackedSource;
  ok: boolean;
  installedVersion: string | null;
  detected: boolean;
  error?: string;
};

export async function checkInstalledFlow(
  source: TrackedSource,
  dependencies: InstalledDetectionDependencies,
): Promise<InstalledDetectionResult> {
  if (!source.appIdentifier) {
    return { source, ok: true, installedVersion: null, detected: false };
  }
  try {
    const installedVersion = await dependencies.invoke<string | null>("get_installed_app_version", {
      identifier: source.appIdentifier,
    });
    const nextSource =
      installedVersion && installedVersion.trim() && source.installedVersionSource !== "manual"
        ? applyDetectedVersion(source, installedVersion)
        : source;
    return { source: nextSource, ok: true, installedVersion: installedVersion ?? null, detected: Boolean(installedVersion?.trim()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { source, ok: false, installedVersion: null, detected: false, error: message };
  }
}

export const detectInstalledApp = checkInstalledFlow;
export const detectInstalledApplication = checkInstalledFlow;
export const checkInstalledApp = checkInstalledFlow;
