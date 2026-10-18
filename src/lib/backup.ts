export const sourcesKey = "updainium.sources.v1";
export const backgroundKey = "updainium.background.v1";
export const backupFileName = "updainium-settings.json";
export const maxBackupBytes = 5 * 1024 * 1024;
export const maxBackupSources = 1000;

export function parseGistId(input: string): string {
  let id = input.trim();
  if (id.startsWith("https://")) {
    const url = new URL(id);
    if (url.hostname !== "gist.github.com" || url.username || url.password || url.port) {
      throw new Error("Enter a gist.github.com URL or a gist ID.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    id = parts.length === 1 ? parts[0] : parts[1];
    if (parts.length > 3) throw new Error("Invalid gist URL.");
  }
  if (!/^[a-f0-9]{1,64}$/i.test(id)) throw new Error("Enter a valid GitHub gist URL or ID.");
  return id;
}

export type BackupSource = {
  id: string;
  repo: string;
  url: string;
  appIdentifier?: string;
  assetExtension?: string;
  assetArchitecture?: "auto" | "x86_64" | "aarch64" | "x86" | "arm";
};
export type Backup = {
  format: "updainium-backup";
  version: 1;
  exportedAt: string;
  settings: { backgroundEnabled: boolean; startOnLogin: boolean };
  sources: BackupSource[];
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).length > maxBackupBytes) throw new Error("Backup exceeds the 5 MB limit.");
  const value: unknown = JSON.parse(text);
  if (!record(value) || value.format !== "updainium-backup" || value.version !== 1 ||
      typeof value.exportedAt !== "string" || !record(value.settings) ||
      typeof value.settings.backgroundEnabled !== "boolean" || typeof value.settings.startOnLogin !== "boolean" ||
      !Array.isArray(value.sources)) throw new Error("This is not a supported Updainium backup (version 1).");
  if (value.sources.length > maxBackupSources) {
    throw new Error(`The backup contains more than ${maxBackupSources} apps.`);
  }
  const ids = new Set<string>();
  const urls = new Set<string>();
  const sources = value.sources.map((source: unknown): BackupSource => {
    if (!record(source) || typeof source.id !== "string" || !source.id.trim() ||
        typeof source.repo !== "string" || !source.repo.trim() || typeof source.url !== "string") {
      throw new Error("The backup contains an invalid app.");
    }
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname.split("/").filter(Boolean).length < 2) {
      throw new Error("App sources must be HTTPS repository URLs without credentials.");
    }
    if (ids.has(source.id) || urls.has(source.url)) throw new Error("The backup contains duplicate apps.");
    ids.add(source.id);
    urls.add(source.url);
    const result: BackupSource = { id: source.id, repo: source.repo, url: source.url };
    for (const key of ["appIdentifier", "assetExtension"] as const) {
      if (source[key] !== undefined) {
        if (typeof source[key] !== "string") throw new Error(`Invalid ${key} in backup.`);
        result[key] = source[key];
      }
    }
    if (source.assetArchitecture !== undefined) {
      if (!["auto", "x86_64", "aarch64", "x86", "arm"].includes(String(source.assetArchitecture))) {
        throw new Error("Invalid app architecture in backup.");
      }
      result.assetArchitecture = source.assetArchitecture as BackupSource["assetArchitecture"];
    }
    return result;
  });
  return { format: "updainium-backup", version: 1, exportedAt: value.exportedAt,
    settings: { backgroundEnabled: value.settings.backgroundEnabled, startOnLogin: value.settings.startOnLogin }, sources };
}

export function createBackup(storage: Pick<Storage, "getItem">, startOnLogin: boolean): Backup {
  return parseBackup(JSON.stringify({ format: "updainium-backup", version: 1,
    exportedAt: new Date().toISOString(),
    settings: { backgroundEnabled: storage.getItem(backgroundKey) === "true", startOnLogin },
    sources: JSON.parse(storage.getItem(sourcesKey) ?? "[]") }));
}

export function restoreSources(backup: Backup, current: unknown, mode: "merge" | "replace") {
  if (!Array.isArray(current)) throw new Error("The local app catalog is invalid.");
  const restored = backup.sources.map((source) => ({ ...source, version: "", assetName: "", assetUrl: "", checkedAt: "", error: "" }));
  if (mode === "replace") return restored;
  if (!current.every((source) => record(source) && typeof source.id === "string" && typeof source.url === "string")) {
    throw new Error("The local app catalog is invalid. Export a copy before replacing it.");
  }
  const result = [...current];
  for (const source of restored) {
    if (result.some((existing) => existing.url === source.url)) continue;
    if (result.some((existing) => existing.id === source.id)) source.id = crypto.randomUUID();
    result.push(source);
  }
  return result;
}
