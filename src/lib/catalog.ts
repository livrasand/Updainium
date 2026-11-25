import type { Architecture } from "./assets";

export type TrackedSource = {
  id: string;
  repo: string;
  url: string;
  appIdentifier?: string;
  assetExtension?: string;
  assetArchitecture?: Architecture;
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  assetName: string;
  assetUrl: string;
  checkedAt: string;
  error: string;
  iconUrl?: string;
  downloadPath?: string;
  sha256?: string;
  downloadedSha256?: string;
  hashVerified?: boolean;
  verificationStatus?: "verified" | "pending" | "unverified" | "failed" | "unavailable";
  signatureStatus?: "valid" | "invalid" | "unavailable";
  signatureIdentity?: string;
  lastKnownInstalledVersion?: string;
  installedVersionSource?: "detected" | "manual";
  updateChannel?: "stable" | "beta";
  skippedVersion?: string;
  ignoredUntil?: string;
  ignoreIndefinitely?: boolean;
  favorite?: boolean;
  favorited?: boolean;
  favourite?: boolean;
  isFavorite?: boolean;
  isFavorited?: boolean;
  isFavourite?: boolean;
  discontinued?: boolean;
  archived?: boolean;
  isDiscontinued?: boolean;
  isArchived?: boolean;
  discontinuedOrArchived?: boolean;
  upstreamDiscontinued?: boolean;
  upstreamArchived?: boolean;
  checkFailed?: boolean;
  checkFailure?: boolean;
  updateCheckFailed?: boolean;
  lastCheckFailed?: boolean;
  failedCheck?: boolean;
  intelOnly?: boolean;
  intel_only?: boolean;
  isIntelOnly?: boolean;
  intelCompatible?: boolean;
  providesIntelBinaries?: boolean;
  intel_compatible?: boolean;
  recent?: boolean;
  isRecent?: boolean;
  recentlyAdded?: boolean;
  recentlyUpdated?: boolean;
  isRecentlyAdded?: boolean;
  isRecentlyUpdated?: boolean;
  addedAt?: string;
  createdAt?: string;
  added?: string;
  updatedAt?: string;
  lastUpdatedAt?: string;
  lastUpdated?: string;
  discontinuedAt?: string;
  archivedAt?: string;
};

const architectureValues = ["auto", "x86_64", "aarch64", "x86", "arm"];

export function normalizeSavedSource(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(normalizeSavedSource);
  if (typeof input === "object" && input !== null) {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        value === null ? undefined : normalizeSavedSource(value),
      ]),
    );
  }
  return input;
}

export function removeSourceFromCatalog(
  sources: TrackedSource[],
  sourceOrId: TrackedSource | string,
): TrackedSource[] {
  const id = typeof sourceOrId === "string" ? sourceOrId : sourceOrId?.id;
  return sources.filter((source) => source.id !== id);
}

export const removeSource = removeSourceFromCatalog;
export const removeTrackedSource = removeSourceFromCatalog;
export const removeApp = removeSourceFromCatalog;
export const removeAppFromCatalog = removeSourceFromCatalog;
export const removeFromCatalog = removeSourceFromCatalog;
export const removeSourceFromSources = removeSourceFromCatalog;

export { removeSourceFlow } from "./removeFlow.ts";

export function isVerifiedSource(source: { verificationStatus?: string; hashVerified?: boolean } | null | undefined): boolean {
  if (!source) return false;
  return source.verificationStatus === "verified" || source.hashVerified === true;
}

export function isMajorVersionChange(
  installedVersion: string | null | undefined,
  latestVersion: string | null | undefined,
): boolean {
  const toParts = (value: string | null | undefined) => value?.match(/\d+/g)?.map(Number) ?? [];
  const installed = toParts(installedVersion);
  const latest = toParts(latestVersion);
  if (!installed.length || !latest.length) return false;
  return (latest[0] ?? 0) > (installed[0] ?? 0);
}

export function isValidTrackedSource(value: unknown): value is TrackedSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.id === "string" &&
    typeof source.repo === "string" &&
    typeof source.url === "string" &&
    (source.appIdentifier === undefined || typeof source.appIdentifier === "string") &&
    (source.assetExtension === undefined || typeof source.assetExtension === "string") &&
    (source.assetArchitecture === undefined ||
      architectureValues.includes(String(source.assetArchitecture))) &&
    typeof source.version === "string" &&
    (source.releaseDate === undefined || typeof source.releaseDate === "string") &&
    (source.releaseNotes === undefined || typeof source.releaseNotes === "string") &&
    typeof source.assetName === "string" &&
    typeof source.assetUrl === "string" &&
    typeof source.checkedAt === "string" &&
    typeof source.error === "string" &&
    (source.lastKnownInstalledVersion === undefined ||
      typeof source.lastKnownInstalledVersion === "string") &&
    (source.installedVersionSource === undefined ||
      source.installedVersionSource === "detected" ||
      source.installedVersionSource === "manual") &&
    (source.sha256 === undefined || typeof source.sha256 === "string") &&
    (source.downloadedSha256 === undefined || typeof source.downloadedSha256 === "string") &&
    (source.hashVerified === undefined || typeof source.hashVerified === "boolean") &&
    (source.verificationStatus === undefined ||
      ["verified", "pending", "unverified", "failed", "unavailable"].includes(String(source.verificationStatus))) &&
    (source.signatureStatus === undefined ||
      ["valid", "invalid", "unavailable"].includes(String(source.signatureStatus))) &&
    (source.signatureIdentity === undefined || typeof source.signatureIdentity === "string") &&
    (source.iconUrl === undefined || typeof source.iconUrl === "string") &&
    (source.updateChannel === undefined ||
      source.updateChannel === "stable" ||
      source.updateChannel === "beta") &&
    (source.skippedVersion === undefined || typeof source.skippedVersion === "string") &&
    (source.ignoredUntil === undefined || typeof source.ignoredUntil === "string") &&
    (source.ignoreIndefinitely === undefined || typeof source.ignoreIndefinitely === "boolean") &&
    (source.favorite === undefined || typeof source.favorite === "boolean") &&
    (source.favorited === undefined || typeof source.favorited === "boolean") &&
    (source.favourite === undefined || typeof source.favourite === "boolean") &&
    (source.isFavorite === undefined || typeof source.isFavorite === "boolean") &&
    (source.isFavorited === undefined || typeof source.isFavorited === "boolean") &&
    (source.isFavourite === undefined || typeof source.isFavourite === "boolean") &&
    (source.discontinued === undefined || typeof source.discontinued === "boolean") &&
    (source.archived === undefined || typeof source.archived === "boolean") &&
    (source.isDiscontinued === undefined || typeof source.isDiscontinued === "boolean") &&
    (source.isArchived === undefined || typeof source.isArchived === "boolean") &&
    (source.discontinuedOrArchived === undefined || typeof source.discontinuedOrArchived === "boolean") &&
    (source.upstreamDiscontinued === undefined || typeof source.upstreamDiscontinued === "boolean") &&
    (source.upstreamArchived === undefined || typeof source.upstreamArchived === "boolean") &&
    (source.checkFailed === undefined || typeof source.checkFailed === "boolean") &&
    (source.checkFailure === undefined || typeof source.checkFailure === "boolean") &&
    (source.updateCheckFailed === undefined || typeof source.updateCheckFailed === "boolean") &&
    (source.lastCheckFailed === undefined || typeof source.lastCheckFailed === "boolean") &&
    (source.failedCheck === undefined || typeof source.failedCheck === "boolean") &&
    (source.intelOnly === undefined || typeof source.intelOnly === "boolean") &&
    (source.intel_only === undefined || typeof source.intel_only === "boolean") &&
    (source.isIntelOnly === undefined || typeof source.isIntelOnly === "boolean") &&
    (source.intelCompatible === undefined || typeof source.intelCompatible === "boolean") &&
    (source.providesIntelBinaries === undefined || typeof source.providesIntelBinaries === "boolean") &&
    (source.intel_compatible === undefined || typeof source.intel_compatible === "boolean") &&
    (source.recent === undefined || typeof source.recent === "boolean") &&
    (source.isRecent === undefined || typeof source.isRecent === "boolean") &&
    (source.recentlyAdded === undefined || typeof source.recentlyAdded === "boolean") &&
    (source.recentlyUpdated === undefined || typeof source.recentlyUpdated === "boolean") &&
    (source.isRecentlyAdded === undefined || typeof source.isRecentlyAdded === "boolean") &&
    (source.isRecentlyUpdated === undefined || typeof source.isRecentlyUpdated === "boolean") &&
    (source.addedAt === undefined || typeof source.addedAt === "string") &&
    (source.createdAt === undefined || typeof source.createdAt === "string") &&
    (source.added === undefined || typeof source.added === "string") &&
    (source.updatedAt === undefined || typeof source.updatedAt === "string") &&
    (source.lastUpdatedAt === undefined || typeof source.lastUpdatedAt === "string") &&
    (source.lastUpdated === undefined || typeof source.lastUpdated === "string") &&
    (source.discontinuedAt === undefined || typeof source.discontinuedAt === "string") &&
    (source.archivedAt === undefined || typeof source.archivedAt === "string")
  );
}
