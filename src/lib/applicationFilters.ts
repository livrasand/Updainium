import type { TrackedSource } from "./catalog.ts";
import { isIgnored } from "./updateChannels.ts";

export type ApplicationView = "all" | "ignored" | "active";
export type ApplicationFilterName =
  | "intelOnly"
  | "discontinued"
  | "checkFailures"
  | "favorites"
  | "recent";

export type ApplicationFilterCriteria = {
  view?: ApplicationView | string;
  activeView?: ApplicationView | string;
  selectedView?: ApplicationView | string;
  mode?: ApplicationView | string;
  filters?: ApplicationFilterName[] | string | string[];
  filter?: ApplicationFilterName[] | string | string[];
  activeFilters?: ApplicationFilterName[] | string | string[];
  activeFilter?: ApplicationFilterName[] | string | string[];
  selectedFilters?: ApplicationFilterName[] | string | string[];
  intelOnly?: boolean;
  discontinued?: boolean;
  checkFailures?: boolean;
  favorites?: unknown;
  favorite?: unknown;
  favorited?: unknown;
  favoriteIds?: unknown;
  favoriteSet?: unknown;
  recent?: boolean;
  recentDays?: number;
  recentThresholdMs?: number;
  now?: unknown;
  favoritesSet?: unknown;
};

const INTEL_ARCHITECTURES = new Set(["x86", "x86_64"]);

function normalizeView(value: unknown): ApplicationView {
  const text = String(value ?? "all").trim().toLowerCase();
  if (text === "ignored" || text === "ignoredview" || text === "ignored-view") return "ignored";
  if (text === "active" || text === "activeview") return "active";
  return "all";
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "function") return toDate((value as () => unknown)());
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function normalizeIdSet(value: unknown): Set<string> | null {
  if (value instanceof Set) return new Set(Array.from(value).map((item) => String(item)));
  if (Array.isArray(value)) return new Set(value.map((item) => String(item)));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.favorites)) return new Set(record.favorites.map((item) => String(item)));
    if (Array.isArray(record.ids)) return new Set(record.ids.map((item) => String(item)));
    if (Array.isArray(record.favoriteIds)) return new Set(record.favoriteIds.map((item) => String(item)));
    const keys = Object.keys(record).filter((key) => record[key] === true || record[key] === 1);
    if (keys.length) return new Set(keys);
  }
  return null;
}

export function isIgnoredApplication(
  source: TrackedSource | null | undefined,
  now: Date = new Date(),
): boolean {
  return isIgnored(source, now);
}

export function isIgnoredViewApplication(
  source: TrackedSource | null | undefined,
  now: Date = new Date(),
): boolean {
  return isIgnored(source, now);
}

export function isInAllView(
  _source: TrackedSource | null | undefined,
): boolean {
  return true;
}

export function isInView(
  source: TrackedSource | null | undefined,
  view: unknown = "all",
  now: Date = new Date(),
): boolean {
  const normalized = normalizeView(view);
  if (normalized === "ignored") return isIgnored(source, now);
  if (normalized === "active") return !isIgnored(source, now);
  return true;
}

export function isFavoriteSource(
  source: TrackedSource | null | undefined,
  favorites?: unknown,
): boolean {
  if (!source) return false;
  if (
    source.favorite === true ||
    source.favorited === true ||
    source.favourite === true ||
    source.isFavorite === true ||
    source.isFavorited === true ||
    source.isFavourite === true
  ) {
    return true;
  }
  const favoriteIds = normalizeIdSet(favorites);
  if (favoriteIds?.has(source.id)) return true;
  return false;
}

export const isFavorite = isFavoriteSource;
export const isFavorited = isFavoriteSource;
export const isFavourite = isFavoriteSource;
export const isFavoriteApp = isFavoriteSource;
export const isFavoriteApplication = isFavoriteSource;
export const isAppFavorite = isFavoriteSource;
export const isApplicationFavorite = isFavoriteSource;

export function isIntelOnlySource(
  source: TrackedSource | null | undefined,
): boolean {
  if (!source) return false;
  if (
    source.intelOnly === true ||
    source.intel_only === true ||
    source.isIntelOnly === true ||
    source.intelCompatible === true ||
    source.providesIntelBinaries === true ||
    source.intel_compatible === true
  ) {
    return true;
  }
  const architecture = String(source.assetArchitecture ?? "").trim().toLowerCase();
  if (INTEL_ARCHITECTURES.has(architecture)) return true;

  const text = `${source.assetName ?? ""} ${source.repo ?? ""} ${source.appIdentifier ?? ""}`.toLowerCase();
  const hasIntelHint = /intel|x86|amd64|x64|i386|i686/.test(text);
  const hasArmHint = /arm|aarch|arm64|armv/.test(text);
  if (hasIntelHint && !hasArmHint) return true;
  return false;
}

export const isIntelOnly = isIntelOnlySource;
export const isIntel = isIntelOnlySource;
export const isIntelCompatible = isIntelOnlySource;
export const providesIntelBinaries = isIntelOnlySource;
export const isX86Only = isIntelOnlySource;
export const isX64Only = isIntelOnlySource;

export function isDiscontinuedSource(
  source: TrackedSource | null | undefined,
): boolean {
  if (!source) return false;
  if (
    source.discontinued === true ||
    source.archived === true ||
    source.isDiscontinued === true ||
    source.isArchived === true ||
    source.discontinuedOrArchived === true ||
    source.upstreamDiscontinued === true ||
    source.upstreamArchived === true
  ) {
    return true;
  }
  const error = String(source.error ?? "").toLowerCase();
  if (/archiv|discontinu|deprecated|unmaintained|no longer maintained/.test(error)) {
    return true;
  }
  const metadata = `${source.releaseNotes ?? ""} ${source.version ?? ""}`.toLowerCase();
  if (/discontinued|archived repository|repository has been archived/.test(metadata)) {
    return true;
  }
  return false;
}

export const isDiscontinued = isDiscontinuedSource;
export const isArchived = isDiscontinuedSource;
export const isDiscontinuedOrArchived = isDiscontinuedSource;
export const isUpstreamDiscontinued = isDiscontinuedSource;
export const isUpstreamArchived = isDiscontinuedSource;

export function hasCheckFailure(
  source: TrackedSource | null | undefined,
): boolean {
  if (!source) return false;
  if (
    source.checkFailed === true ||
    source.checkFailure === true ||
    source.updateCheckFailed === true ||
    source.lastCheckFailed === true ||
    source.failedCheck === true
  ) {
    return true;
  }
  return Boolean(String(source.error ?? "").trim());
}

export const checkFailed = hasCheckFailure;
export const hasFailedCheck = hasCheckFailure;
export const hasUpdateCheckFailure = hasCheckFailure;
export const updateCheckFailed = hasCheckFailure;
export const isCheckFailure = hasCheckFailure;

export function isRecentSource(
  source: TrackedSource | null | undefined,
  options: { now?: unknown; recentDays?: number; recentThresholdMs?: number } | Date | number | string = {},
): boolean {
  if (options instanceof Date || typeof options === "number" || typeof options === "string") {
    options = { now: options };
  }
  options = (options ?? {}) as { now?: unknown; recentDays?: number; recentThresholdMs?: number };
  if (!source) return false;
  if (
    source.recent === true ||
    source.isRecent === true ||
    source.recentlyAdded === true ||
    source.recentlyUpdated === true ||
    source.isRecentlyAdded === true ||
    source.isRecentlyUpdated === true
  ) {
    return true;
  }
  const thresholdMs =
    typeof options.recentThresholdMs === "number"
      ? options.recentThresholdMs
      : (options.recentDays ?? 30) * 24 * 60 * 60 * 1000;
  const nowDate = toDate(options.now);
  const candidates = [
    source.addedAt,
    source.createdAt,
    source.added,
    source.updatedAt,
    source.lastUpdatedAt,
    source.lastUpdated,
    source.releaseDate,
    source.checkedAt,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));

  return candidates.some((timestamp) => {
    const age = nowDate.getTime() - timestamp;
    return age >= 0 && age <= thresholdMs;
  });
}

export const isRecent = isRecentSource;
export const isRecentlyAdded = isRecentSource;
export const isRecentlyUpdated = isRecentSource;
export const isRecentApplication = isRecentSource;
export const isRecentApp = isRecentSource;

function normalizeFilters(criteria: ApplicationFilterCriteria): ApplicationFilterName[] {
  const filters: string[] = [];
  const inputFilters =
    criteria.filters ?? criteria.activeFilters ?? criteria.selectedFilters ?? criteria.filter ?? criteria.activeFilter;
  if (Array.isArray(inputFilters)) filters.push(...inputFilters.map((item) => String(item)));
  else if (typeof inputFilters === "string" && inputFilters.trim()) filters.push(inputFilters);

  const booleanMap: Array<[string, ApplicationFilterName]> = [
    ["intelOnly", "intelOnly"],
    ["intel_only", "intelOnly"],
    ["discontinued", "discontinued"],
    ["archived", "discontinued"],
    ["checkFailures", "checkFailures"],
    ["checkFailure", "checkFailures"],
    ["failedChecks", "checkFailures"],
    ["favorites", "favorites"],
    ["favorite", "favorites"],
    ["favorited", "favorites"],
    ["recent", "recent"],
    ["recentlyAdded", "recent"],
    ["recentlyUpdated", "recent"],
  ];
  for (const [key, filterName] of booleanMap) {
    if ((criteria as Record<string, unknown>)[key] === true && !filters.includes(filterName)) {
      filters.push(filterName);
    }
  }
  return filters
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const lower = item.toLowerCase().replace(/[\s_-]+/g, "");
      if (lower === "intel" || lower === "intelonly" || lower === "intelcompatible") return "intelOnly";
      if (lower === "discontinued" || lower === "archived" || lower === "discontinuedorarchived") return "discontinued";
      if (lower === "checkfailures" || lower === "checkfailure" || lower === "failedchecks" || lower === "updatecheckfailures") return "checkFailures";
      if (lower === "favorites" || lower === "favorite" || lower === "favorited") return "favorites";
      if (lower === "recent" || lower === "recentlyadded" || lower === "recentlyupdated" || lower === "recentapplications") return "recent";
      return item as ApplicationFilterName;
    })
    .filter((item): item is ApplicationFilterName =>
      ["intelOnly", "discontinued", "checkFailures", "favorites", "recent"].includes(item),
    );
}

export function matchesApplicationFilters(
  source: TrackedSource | null | undefined,
  criteria: ApplicationFilterCriteria = {},
  favorites?: unknown,
): boolean {
  const normalizedCriteria = { ...criteria };
  if (favorites !== undefined) normalizedCriteria.favorites = favorites;
  const view = normalizeView(normalizedCriteria.view ?? normalizedCriteria.activeView ?? normalizedCriteria.selectedView ?? normalizedCriteria.mode);
  const now = toDate(normalizedCriteria.now);
  if (!isInView(source, view, now)) return false;

  const filters = normalizeFilters(normalizedCriteria);
  const favoriteIds =
    normalizeIdSet(normalizedCriteria.favorites) ??
    normalizeIdSet(normalizedCriteria.favoriteIds) ??
    normalizeIdSet(normalizedCriteria.favoriteSet) ??
    normalizeIdSet(normalizedCriteria.favoritesSet) ??
    normalizeIdSet(normalizedCriteria.favorite) ??
    normalizeIdSet(normalizedCriteria.favorited);

  for (const filter of filters) {
    if (filter === "intelOnly" && !isIntelOnlySource(source)) return false;
    if (filter === "discontinued" && !isDiscontinuedSource(source)) return false;
    if (filter === "checkFailures" && !hasCheckFailure(source)) return false;
    if (filter === "favorites" && !isFavoriteSource(source, favoriteIds)) return false;
    if (filter === "recent" && !isRecentSource(source, { now, recentDays: normalizedCriteria.recentDays, recentThresholdMs: normalizedCriteria.recentThresholdMs })) return false;
  }
  return true;
}

export const matchesFilters = matchesApplicationFilters;
export const matchesApplicationFilter = matchesApplicationFilters;
export const appliesFilters = matchesApplicationFilters;
export const filterMatch = matchesApplicationFilters;

export function filterApplications(
  sources: TrackedSource[] | null | undefined,
  criteria?: ApplicationFilterCriteria | ApplicationView | ApplicationFilterName[] | string,
  favorites?: unknown,
): TrackedSource[] {
  const list = Array.isArray(sources) ? sources : [];
  let normalizedCriteria: ApplicationFilterCriteria = {};
  if (criteria instanceof Date || typeof criteria === "number") {
    normalizedCriteria = { now: criteria };
  } else if (typeof criteria === "string") {
    if (["all", "ignored", "active"].includes(criteria.toLowerCase())) {
      normalizedCriteria.view = criteria;
    } else {
      normalizedCriteria.filters = [criteria];
    }
  } else if (Array.isArray(criteria)) {
    normalizedCriteria.filters = criteria as string[];
  } else if (criteria && typeof criteria === "object") {
    normalizedCriteria = { ...(criteria as ApplicationFilterCriteria) };
  }
  if (favorites !== undefined) normalizedCriteria.favorites = favorites;

  return list.filter((source) => matchesApplicationFilters(source, normalizedCriteria, normalizedCriteria.favorites));
}

export const filterSources = filterApplications;
export const filterApps = filterApplications;
export const filterAppList = filterApplications;
export const applyFilters = filterApplications;
export const applyApplicationFilters = filterApplications;
export const getFilteredApplications = filterApplications;
export const getVisibleApplications = filterApplications;
export const visibleApplications = filterApplications;
export const getFilteredSources = filterApplications;
export const getVisibleSources = filterApplications;
export const narrowApplications = filterApplications;

export function getApplicationCounts(
  sources: TrackedSource[] | null | undefined,
  criteria?: ApplicationFilterCriteria | unknown,
  favorites?: unknown,
): Record<string, number> {
  const list = Array.isArray(sources) ? sources : [];
  if (criteria instanceof Date || typeof criteria === "number" || typeof criteria === "string") {
    criteria = { now: criteria };
  }
  const normalizedCriteria = (criteria && typeof criteria === "object" ? criteria : {}) as ApplicationFilterCriteria;
  const now = toDate(normalizedCriteria.now);
  const favoriteIds =
    normalizeIdSet(favorites) ??
    normalizeIdSet(normalizedCriteria.favorites) ??
    normalizeIdSet(normalizedCriteria.favoriteIds) ??
    normalizeIdSet(normalizedCriteria.favoriteSet);

  const counts = {
    all: list.length,
    total: list.length,
    ignored: list.filter((source) => isIgnored(source, now)).length,
    active: list.filter((source) => !isIgnored(source, now)).length,
    intelOnly: list.filter((source) => isIntelOnlySource(source)).length,
    discontinued: list.filter((source) => isDiscontinuedSource(source)).length,
    archived: list.filter((source) => isDiscontinuedSource(source)).length,
    checkFailures: list.filter((source) => hasCheckFailure(source)).length,
    favorites: list.filter((source) => isFavoriteSource(source, favoriteIds)).length,
    recent: list.filter((source) => isRecentSource(source, { now, recentDays: normalizedCriteria.recentDays, recentThresholdMs: normalizedCriteria.recentThresholdMs })).length,
  };
  return counts;
}

export const countApplications = getApplicationCounts;
export const applicationCounts = getApplicationCounts;
export const countByFilter = getApplicationCounts;
export const getApplicationCount = getApplicationCounts;
export const countsForApplications = getApplicationCounts;

export function hasNoMatchingApplications(
  sources: TrackedSource[] | null | undefined,
  criteria?: ApplicationFilterCriteria | ApplicationView | ApplicationFilterName[] | string,
  favorites?: unknown,
): boolean {
  return filterApplications(sources, criteria as never, favorites).length === 0;
}

export const isEmptyResult = hasNoMatchingApplications;
export const isEmptyState = hasNoMatchingApplications;
export const hasEmptyState = hasNoMatchingApplications;
export const noMatchingApplications = hasNoMatchingApplications;

export function getFavoriteIdsFromSettings(settingsLike: unknown): string[] {
  const record = settingsLike && typeof settingsLike === "object" ? (settingsLike as Record<string, unknown>) : null;
  const plugins = record?.plugins && typeof record.plugins === "object" ? (record.plugins as Record<string, unknown>) : null;
  const favorites = plugins?.favorites ?? record?.favorites;
  const ids = normalizeIdSet(favorites);
  return ids ? Array.from(ids) : [];
}

export function applyFavoriteIdsToSources(sources: TrackedSource[] | null | undefined, favoriteIds: unknown): TrackedSource[] {
  const ids = normalizeIdSet(favoriteIds);
  return (sources ?? []).map((source) => {
    const favorite = Boolean(ids?.has(source.id) || source.favorite || source.favorited || source.isFavorite);
    return { ...source, favorite };
  });
}

export function mergeFavoritePreference(
  source: TrackedSource,
  favorite: boolean,
): TrackedSource {
  return { ...source, favorite: Boolean(favorite) };
}

export function toggleFavoriteSource(source: TrackedSource): TrackedSource {
  return mergeFavoritePreference(source, !isFavoriteSource(source));
}

export const toggleFavorite = toggleFavoriteSource;
export const setFavorite = mergeFavoritePreference;
export const markFavorite = (source: TrackedSource) => mergeFavoritePreference(source, true);
export const unmarkFavorite = (source: TrackedSource) => mergeFavoritePreference(source, false);

export function normalizeApplicationView(value: unknown): ApplicationView {
  return normalizeView(value);
}

export function viewPreferenceKey(): string {
  return "plugins.applicationView";
}

export function filterPreferenceKey(): string {
  return "plugins.applicationFilters";
}

// Re-export ignored helpers from update channels for convenience.
export { isIgnored, getIgnoredApps, getActiveApps } from "./updateChannels.ts";
