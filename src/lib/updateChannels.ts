import type { TrackedSource } from "./catalog.ts";
import { extractVersionNumbers, versionsEqual, hasUpdate as hasVersionUpdate, resolveInstalledVersion } from "./versionComparison.ts";

export type UpdateChannel = "stable" | "beta";

export function normalizeChannel(value: unknown): UpdateChannel {
  return value === "beta" ? "beta" : "stable";
}

export function getUpdateChannel(source: TrackedSource | null | undefined): UpdateChannel {
  return normalizeChannel(source?.updateChannel);
}

export function isPrereleaseVersion(value: string | null | undefined): boolean {
  if (!value) return false;
  return /alpha|beta|rc|pre|dev|nightly|canary|preview/i.test(value) || /-/.test(value);
}

export function isStableVersion(value: string | null | undefined): boolean {
  return !isPrereleaseVersion(value);
}

export function isIgnored(
  source: TrackedSource | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!source) return false;
  if (source.ignoreIndefinitely === true) return true;
  if (source.ignoredUntil) {
    const until = new Date(source.ignoredUntil);
    if (!Number.isNaN(until.getTime()) && now < until) return true;
  }
  return false;
}

export function isIgnoreExpired(
  source: TrackedSource | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!source || source.ignoreIndefinitely) return false;
  if (!source.ignoredUntil) return false;
  const until = new Date(source.ignoredUntil);
  if (Number.isNaN(until.getTime())) return true;
  return now >= until;
}

export function shouldConsiderRelease(
  source: TrackedSource | null | undefined,
  releaseVersion: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!source || !releaseVersion) return false;
  if (isIgnored(source, now)) return false;
  const channel = getUpdateChannel(source);
  if (channel === "stable" && isPrereleaseVersion(releaseVersion)) return false;
  if (isSkippedVersion(source, releaseVersion)) return false;
  return true;
}

export function isSkippedVersion(
  source: TrackedSource | null | undefined,
  version: string | null | undefined,
): boolean {
  if (!source?.skippedVersion || !version) return false;
  return versionsEqual(source.skippedVersion, version) || source.skippedVersion === version;
}

export function skipVersion(source: TrackedSource, version: string): TrackedSource {
  return { ...source, skippedVersion: version };
}

export function unskipVersion(source: TrackedSource): TrackedSource {
  const { skippedVersion: _removed, ...rest } = source;
  return rest as TrackedSource;
}

export const reconsiderSkippedVersion = unskipVersion;
export const restoreSkippedVersion = unskipVersion;

export function ignoreAppTemporarily(
  source: TrackedSource,
  until: string | Date,
): TrackedSource {
  const untilString = until instanceof Date ? until.toISOString() : String(until);
  return { ...source, ignoredUntil: untilString, ignoreIndefinitely: false };
}

export function ignoreAppForDuration(
  source: TrackedSource,
  durationMs: number,
  now: Date = new Date(),
): TrackedSource {
  return ignoreAppTemporarily(source, new Date(now.getTime() + durationMs));
}

export function ignoreAppIndefinitely(source: TrackedSource): TrackedSource {
  return { ...source, ignoreIndefinitely: true, ignoredUntil: undefined };
}

export function ignoreApp(source: TrackedSource, until?: string | Date): TrackedSource {
  if (!until) return ignoreAppIndefinitely(source);
  return ignoreAppTemporarily(source, until);
}

export function restoreApp(source: TrackedSource): TrackedSource {
  const { ignoredUntil: _i, ...rest } = source;
  return { ...rest, ignoreIndefinitely: false } as TrackedSource;
}

export const unignoreApp = restoreApp;
export const resumeApp = restoreApp;
export const restoreUpdates = restoreApp;

export function setUpdateChannel(source: TrackedSource, channel: UpdateChannel): TrackedSource {
  return { ...source, updateChannel: normalizeChannel(channel) };
}

export function withChannel(source: TrackedSource, channel: UpdateChannel): TrackedSource {
  return setUpdateChannel(source, channel);
}

export function isUpdateEligible(
  source: TrackedSource,
  latestVersion: string,
  installedVersions?: Record<string, string | null | undefined>,
  now: Date = new Date(),
): boolean {
  if (isIgnored(source, now)) return false;
  if (isSkippedVersion(source, latestVersion)) return false;
  const channel = getUpdateChannel(source);
  if (channel === "stable" && isPrereleaseVersion(latestVersion)) return false;
  const installed = installedVersions
    ? installedVersions[source.id] ?? resolveInstalledVersion(source, null)
    : resolveInstalledVersion(source, null);
  if (!installed) return false;
  return hasVersionUpdate(installed, latestVersion);
}

export const isEligibleForUpdates = isUpdateEligible;
export const canReceiveUpdate = isUpdateEligible;

// Channel-aware filtering of a list of releases/versions.
export function filterReleasesForChannel(
  releases: string[],
  channel: UpdateChannel,
): string[] {
  return (releases ?? []).filter((release) =>
    channel === "beta" ? true : isStableVersion(release),
  );
}

export function getIgnoredApps(sources: TrackedSource[], now?: Date): TrackedSource[] {
  return (sources ?? []).filter((source) => isIgnored(source, now ?? new Date()));
}

export function getActiveApps(sources: TrackedSource[], now?: Date): TrackedSource[] {
  return (sources ?? []).filter((source) => !isIgnored(source, now ?? new Date()));
}
