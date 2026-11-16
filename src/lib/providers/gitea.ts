import type { Provider } from "./types";
import { createReference, normalizeRelease } from "./shared";

export const giteaProvider: Provider = {
  id: "gitea",
  match() {
    return true;
  },
  reference(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const marker = parts.indexOf("releases");
    const repositoryParts = marker >= 2 ? parts.slice(0, marker) : parts;
    return createReference(url.hostname.toLowerCase(), url.origin, repositoryParts, "gitea");
  },
  repoApiUrl(reference) {
    const origin = new URL(reference.url).origin;
    const repositoryPath = reference.repositoryPath.split("/").map(encodeURIComponent).join("/");
    return `${origin}/api/v1/repos/${repositoryPath}`;
  },
  releaseApiUrls(reference) {
    const origin = new URL(reference.url).origin;
    const repositoryPath = reference.repositoryPath.split("/").map(encodeURIComponent).join("/");
    return [
      `${origin}/api/v1/repos/${repositoryPath}/releases/latest`,
      `${origin}/api/v3/repos/${reference.repositoryPath}/releases/latest`,
      `${origin}/api/v4/projects/${encodeURIComponent(reference.repositoryPath)}/releases/permalink/latest`,
    ];
  },
  normalize: normalizeRelease,
};