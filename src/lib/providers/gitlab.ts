import type { Provider } from "./types";
import { createReference, normalizeRelease } from "./shared";

export const gitlabProvider: Provider = {
  id: "gitlab",
  match(url) {
    if (url.hostname.toLowerCase() === "gitlab.com") return true;
    return url.pathname.split("/").filter(Boolean).indexOf("-") >= 2;
  },
  reference(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const marker = parts.indexOf("-");
    const repositoryParts = marker >= 2 ? parts.slice(0, marker) : parts;
    return createReference(url.hostname.toLowerCase(), url.origin, repositoryParts, "gitlab");
  },
  repoApiUrl(reference) {
    const origin = new URL(reference.url).origin;
    return `${origin}/api/v4/projects/${encodeURIComponent(reference.repositoryPath)}`;
  },
  releaseApiUrls(reference) {
    const origin = new URL(reference.url).origin;
    return [
      `${origin}/api/v4/projects/${encodeURIComponent(reference.repositoryPath)}/releases/permalink/latest`,
    ];
  },
  normalize: normalizeRelease,
};