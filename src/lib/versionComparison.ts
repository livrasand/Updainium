export type InstalledVersionSource = "detected" | "manual";

export interface VersionedSource {
  id: string;
  version: string;
  lastKnownInstalledVersion?: string;
  installedVersionSource?: InstalledVersionSource;
}

export function extractVersionNumbers(value: string | null | undefined): number[] | null {
  if (!value) return null;
  const parts = value.match(/\d+/g)?.map(Number);
  return parts && parts.length > 0 ? parts : null;
}

export function resolveInstalledVersion(
  source: VersionedSource,
  detected: string | null | undefined,
): string | null {
  if (source.installedVersionSource === "manual" && source.lastKnownInstalledVersion?.trim()) {
    return source.lastKnownInstalledVersion.trim();
  }
  if (typeof detected === "string" && detected.trim()) {
    return detected.trim();
  }
  if (detected === null && source.installedVersionSource !== "manual") {
    return null;
  }
  return source.lastKnownInstalledVersion?.trim() || null;
}

export function versionsEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftParts = extractVersionNumbers(left ?? "");
  const rightParts = extractVersionNumbers(right ?? "");
  if (!leftParts || !rightParts) return false;
  const length = Math.max(leftParts.length, rightParts.length);
  return Array.from({ length }, (_, index) =>
    (leftParts[index] ?? 0) === (rightParts[index] ?? 0),
  ).every(Boolean);
}

export function hasUpdate(
  installedVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): boolean {
  const installedParts = extractVersionNumbers(installedVersion ?? "");
  const latestParts = extractVersionNumbers(latestVersion ?? "");
  if (!installedParts || !latestParts) return false;
  for (let index = 0; index < Math.max(installedParts.length, latestParts.length); index += 1) {
    const installedPart = installedParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;
    if (latestPart !== installedPart) return latestPart > installedPart;
  }
  return false;
}

export function isInstalledVersionCurrent(
  installedVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): boolean {
  return Boolean(installedVersion?.trim()) && versionsEqual(installedVersion, latestVersion);
}

export function isMajorVersionChange(
  installedVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): boolean {
  const installedParts = extractVersionNumbers(installedVersion ?? "");
  const latestParts = extractVersionNumbers(latestVersion ?? "");
  if (!installedParts || !latestParts) return false;
  return (latestParts[0] ?? 0) > (installedParts[0] ?? 0);
}

export const isMajorUpdate = isMajorVersionChange;
export const hasMajorVersionChange = isMajorVersionChange;
