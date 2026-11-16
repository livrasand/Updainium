import type { Provider } from "./types";
import { createReference, normalizeRelease } from "./shared";

export const githubProvider: Provider = {
  id: "github",
  match(url) {
    return url.hostname.toLowerCase() === "github.com";
  },
  reference(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    return createReference(url.hostname.toLowerCase(), url.origin, parts.slice(0, 2), "github");
  },
  repoApiUrl(reference) {
    return `https://api.github.com/repos/${reference.repositoryPath}`;
  },
  releaseApiUrls(reference) {
    return [`https://api.github.com/repos/${reference.repositoryPath}/releases/latest`];
  },
  normalize: normalizeRelease,
};