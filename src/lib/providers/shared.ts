import type { ReleaseAsset } from "../assets";
import type { Release, SourceReference } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function sha256Field(value: unknown): string | undefined {
  const digest = stringField(value, "digest") ?? stringField(value, "sha256");
  if (!digest) return undefined;
  const normalized = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : digest;
  return normalized.length === 64 && /^[0-9a-fA-F]+$/.test(normalized)
    ? normalized.toLowerCase()
    : undefined;
}

export function createReference(
  hostname: string,
  origin: string,
  parts: string[],
  provider: string,
): SourceReference {
  const repositoryPath = parts.join("/").replace(/\.git$/i, "");
  const url = new URL(`/${repositoryPath}`, origin).toString().replace(/\/$/, "");
  return { repo: `${hostname}/${repositoryPath}`, url, repositoryPath, provider };
}

export function normalizeRelease(payload: unknown): Release {
  const value = Array.isArray(payload) && payload.length > 0 ? payload[0] : payload;
  if (!isRecord(value)) return { assets: [] };

  const assets: ReleaseAsset[] = [];
  const rawAssets = value.assets;
  if (Array.isArray(rawAssets)) {
    for (const item of rawAssets) {
      const assetName = stringField(item, "name");
      const url = stringField(item, "browser_download_url");
      if (assetName && url) {
        assets.push({ name: assetName, browser_download_url: url, sha256: sha256Field(item) });
      }
    }
  } else if (isRecord(rawAssets) && Array.isArray(rawAssets.links)) {
    for (const link of rawAssets.links) {
      const assetName = stringField(link, "name");
      const url = stringField(link, "direct_asset_url") ?? stringField(link, "url");
      if (assetName && url) {
        assets.push({ name: assetName, browser_download_url: url, sha256: sha256Field(link) });
      }
    }
  }

  return {
    tag_name: stringField(value, "tag_name"),
    name: stringField(value, "name"),
    published_at:
      stringField(value, "published_at") ??
      stringField(value, "released_at") ??
      stringField(value, "created_at"),
    body: stringField(value, "body") ?? stringField(value, "description"),
    assets,
  };
}