import { assetForExtension, assetForPlatform, type Platform } from "./assets.ts";
import { giteaProvider } from "./providers/gitea.ts";
import { githubProvider } from "./providers/github.ts";
import { gitlabProvider } from "./providers/gitlab.ts";
import type { TrackedSource } from "./catalog";
import type { Release } from "./providers/types";

export type ReleaseCheckDependencies = {
  fetchReleaseMetadata: (apiUrls: string[]) => Promise<unknown>;
  fetchRepositoryIcon?: (apiUrl: string) => Promise<string | null | undefined>;
  now?: () => string;
};

export type ReleaseCheckResult = {
  source: TrackedSource;
  ok: boolean;
  error?: string;
};

const providers = [githubProvider, gitlabProvider, giteaProvider];

function resolveProvider(input: string | URL): { provider: (typeof providers)[number]; reference: import("./providers/types.ts").SourceReference } {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : input;
  } catch {
    throw new Error("Enter a valid URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("The source must use a valid HTTPS URL.");
  }
  const provider =
    providers.find((candidate) => candidate.match(url)) ?? providers[providers.length - 1];
  const reference = provider.reference(url);
  if (reference.repositoryPath.split("/").length < 2) {
    throw new Error("The URL must point to a public repository.");
  }
  return { provider, reference };
}

export async function checkSourceFlow(
  source: TrackedSource,
  platform: Platform | null,
  dependencies: ReleaseCheckDependencies,
): Promise<ReleaseCheckResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  try {
    const { provider, reference } = resolveProvider(source.url);
    let iconUrl = source.iconUrl;
    if (!iconUrl && dependencies.fetchRepositoryIcon) {
      try {
        const fetchedIcon = await dependencies.fetchRepositoryIcon(provider.repoApiUrl(reference));
        iconUrl = fetchedIcon ? fetchedIcon : undefined;
      } catch {
        // Icons are decorative; a failure must not block release checks.
      }
    }

    const apiUrls = provider.releaseApiUrls(reference);
    const payload = await dependencies.fetchReleaseMetadata(apiUrls);
    const release = provider.normalize(payload) as Release;
    const assets = release.assets ?? [];

    const asset = platform
      ? source.assetExtension
        ? assetForExtension(
            assets,
            source.assetExtension,
            source.assetArchitecture ?? "auto",
            platform,
          )
        : assetForPlatform(assets, platform)
      : undefined;

    if (!asset) {
      if (source.assetExtension) {
        const architecture = source.assetArchitecture ?? "auto";
        const availableExtensions = [
          ...new Set(
            assets
              .map((item) => (item.name.match(/\.[^./]+$/)?.[0] ?? "").toLowerCase())
              .filter(Boolean),
          ),
        ].sort();
        const availableLabel = availableExtensions.length
          ? ` This release offers: ${availableExtensions.join(", ")}.`
          : "";
        throw new Error(
          `No release asset ends with ${source.assetExtension} for ${architecture}.${availableLabel}`,
        );
      }
      const supported = platform ? (assets.length ? "see release assets" : "no known formats") : "no platform";
      throw new Error(
        `No release asset matched ${platform?.os ?? "this system"} ${platform?.arch ?? ""} automatically. Preferred formats: ${supported}.`,
      );
    }

    const updated: TrackedSource = {
      ...source,
      version: release.tag_name || release.name || "Unversioned release",
      releaseDate: release.published_at ?? undefined,
      releaseNotes: release.body ?? undefined,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      sha256: asset.sha256 ?? undefined,
      checkedAt: now(),
      error: "",
      iconUrl: iconUrl ?? source.iconUrl,
      downloadPath: undefined,
      downloadedSha256: undefined,
      hashVerified: undefined,
    };
    return { source: updated, ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      source: { ...source, checkedAt: now(), error: detail },
      ok: false,
      error: detail,
    };
  }
}
