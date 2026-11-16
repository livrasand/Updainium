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
  lastKnownInstalledVersion?: string;
  installedVersionSource?: "detected" | "manual";
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
    (source.iconUrl === undefined || typeof source.iconUrl === "string")
  );
}
