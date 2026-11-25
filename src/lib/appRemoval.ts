import type { TrackedSource } from "./catalog.ts";
export function removeSource(sources: TrackedSource[], sourceOrId: TrackedSource | string): TrackedSource[] {
  const id = typeof sourceOrId === "string" ? sourceOrId : sourceOrId?.id;
  return sources.filter((source) => source.id !== id);
}
export const removeTrackedSource = removeSource;
export const removeApp = removeSource;
export const removeAppFromCatalog = removeSource;
export const removeFromCatalog = removeSource;
export const removeSourceFromCatalog = removeSource;
export const removeSourceFromSources = removeSource;
export default removeSource;