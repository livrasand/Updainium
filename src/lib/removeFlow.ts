import type { TrackedSource } from "./catalog.ts";

export type RemoveSourceDependencies = {
  confirm?: (message: string) => boolean | Promise<boolean>;
  deleteResumeSession?: (sourceId: string) => void;
  persist?: (sources: TrackedSource[]) => void | Promise<void>;
};

export type RemoveResult = {
  sources: TrackedSource[];
  removed: boolean;
};

export async function removeSourceFlow(...args: unknown[]): Promise<RemoveResult & { ok: boolean; source: TrackedSource | null }> {
  let sources: TrackedSource[] = [];
  let sourceOrId: TrackedSource | string | undefined;
  let dependencies: RemoveSourceDependencies = {};

  if (Array.isArray(args[0])) {
    sources = args[0] as TrackedSource[];
    sourceOrId = args[1] as TrackedSource | string | undefined;
    dependencies = (args[2] as RemoveSourceDependencies) ?? {};
  } else if (args[0] && typeof args[0] === "object" && "repo" in (args[0] as Record<string, unknown>)) {
    const source = args[0] as TrackedSource;
    sources = [source];
    sourceOrId = source;
    dependencies = (args[1] as RemoveSourceDependencies) ?? {};
  } else {
    sources = [];
    sourceOrId = args[0] as TrackedSource | string | undefined;
    dependencies = (args[1] as RemoveSourceDependencies) ?? {};
  }

  const id = typeof sourceOrId === "string" ? sourceOrId : sourceOrId?.id;
  const source = sources.find((item) => item.id === id);
  if (!source) return { sources: [...sources], removed: false, ok: false, source: null };

  const confirmed = dependencies.confirm
    ? await dependencies.confirm(`Remove ${source.repo} from your catalog?`)
    : true;
  if (!confirmed) return { sources: [...sources], removed: false, ok: false, source };

  dependencies.deleteResumeSession?.(source.id);
  const nextSources = sources.filter((item) => item.id !== source.id);
  await dependencies.persist?.(nextSources);
  return { sources: nextSources, removed: true, ok: true, source };
}

export const removeSource = (sources: TrackedSource[], sourceOrId: TrackedSource | string) =>
  sources.filter((source) => source.id !== (typeof sourceOrId === "string" ? sourceOrId : sourceOrId?.id));
export const removeTrackedSource = removeSource;
export const removeApp = removeSource;
export const removeAppFromCatalog = removeSource;
export const removeFromCatalog = removeSource;
export const removeSourceFromCatalog = removeSource;
export const removeSourceFromSources = removeSource;