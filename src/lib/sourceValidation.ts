import type { Architecture } from "./assets";
import type { TrackedSource } from "./catalog.ts";

export type SourceInput = {
  url: string;
  appIdentifier?: string;
  extension?: string;
  architecture?: Architecture;
};

export const extensionPattern = /^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/i;

export function normalizeExtension(input: string | undefined | null): string | undefined {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return undefined;
  const withDot = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
  return withDot;
}

export function isValidExtension(extension: string): boolean {
  return extensionPattern.test(extension);
}

export function normalizeArchitecture(input: string | undefined | null): Architecture {
  const value = (input ?? "auto").trim().toLowerCase();
  if (value === "auto" || value === "x86_64" || value === "aarch64" || value === "x86" || value === "arm") {
    return value as Architecture;
  }
  return "auto";
}

export function validateSourceUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Enter a valid HTTPS repository URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("The source must use a valid HTTPS URL.");
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("The URL must point to a public repository.");
  }
  return parsed;
}

export function findDuplicateSource(
  sources: TrackedSource[],
  url: string,
  editingId?: string | null,
): TrackedSource | undefined {
  const normalized = url.trim().toLowerCase();
  return sources.find(
    (source) => source.id !== editingId && source.url.trim().toLowerCase() === normalized,
  );
}

export function validateAddAppInput(
  input: SourceInput,
  existingSources: TrackedSource[],
  editingId?: string | null,
): { url: URL; extension?: string; architecture: Architecture; appIdentifier?: string } {
  const url = validateSourceUrl(input.url);
  const extension = normalizeExtension(input.extension);
  if (extension && !isValidExtension(extension)) {
    throw new Error(
      "Enter a valid file extension, such as .AppImage or .zip, or leave the field empty to match the release automatically.",
    );
  }
  const duplicate = findDuplicateSource(existingSources, url.toString(), editingId);
  if (duplicate) {
    throw new Error("This repository is already in your catalog.");
  }
  const appIdentifier = input.appIdentifier?.trim() || undefined;
  return {
    url,
    extension,
    architecture: normalizeArchitecture(input.architecture),
    appIdentifier,
  };
}

export function buildTrackedSource(
  input: SourceInput,
  existingSources: TrackedSource[],
  editingId?: string | null,
  currentSource?: TrackedSource,
): TrackedSource {
  const validated = validateAddAppInput(input, existingSources, editingId);
  const repoPath = validated.url.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
  const repo = `${validated.url.hostname.toLowerCase()}/${repoPath}`;
  const normalizedUrl = validated.url.toString().replace(/\/$/, "");
  return {
    id: editingId ?? crypto.randomUUID(),
    repo,
    url: normalizedUrl,
    appIdentifier: validated.appIdentifier,
    assetExtension: validated.extension,
    assetArchitecture: validated.architecture,
    version: "",
    assetName: "",
    assetUrl: "",
    checkedAt: "",
    error: "",
    lastKnownInstalledVersion:
      currentSource?.url?.trim().toLowerCase() === normalizedUrl.toLowerCase()
        ? currentSource.lastKnownInstalledVersion
        : undefined,
    installedVersionSource:
      currentSource?.url?.trim().toLowerCase() === normalizedUrl.toLowerCase()
        ? currentSource.installedVersionSource
        : undefined,
    iconUrl:
      currentSource?.url?.trim().toLowerCase() === normalizedUrl.toLowerCase()
        ? currentSource.iconUrl
        : undefined,
  };
}
