import { appConfigDir, BaseDirectory } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isValidTrackedSource, normalizeSavedSource, type TrackedSource } from "./catalog";

export type Settings = {
  version: 1;
  sources: TrackedSource[];
  backgroundEnabled: boolean;
  startOnLogin: boolean;
  mainBackups: Record<string, string>;
  plugins: Record<string, unknown>;
};

const legacySourcesKey = "updainium.sources.v1";
const legacyBackgroundKey = "updainium.background.v1";
const legacyMainBackupPrefix = "updainium.main-gist.v1.";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createDefaultSettings(): Settings {
  return {
    version: 1,
    sources: [],
    backgroundEnabled: false,
    startOnLogin: false,
    mainBackups: {},
    plugins: {},
  };
}

function parseSettings(input: unknown): Settings {
  if (!record(input)) throw new Error("Invalid settings.");
  if (input.version !== undefined && input.version !== 1) {
    throw new Error("Unsupported settings version.");
  }
  const sources = Array.isArray(input.sources)
    ? input.sources.map(normalizeSavedSource).filter(isValidTrackedSource)
    : [];
  const mainBackups: Record<string, string> = {};
  if (record(input.mainBackups)) {
    for (const [login, id] of Object.entries(input.mainBackups)) {
      if (typeof id === "string" && id.trim()) mainBackups[login.toLowerCase()] = id;
    }
  }
  return {
    version: 1,
    sources,
    backgroundEnabled: input.backgroundEnabled === true,
    startOnLogin: input.startOnLogin === true,
    mainBackups,
    plugins: record(input.plugins) ? input.plugins : {},
  };
}

function migrateSettings(): Settings {
  const result = createDefaultSettings();
  try {
    const raw = localStorage.getItem(legacySourcesKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        result.sources = parsed.map(normalizeSavedSource).filter(isValidTrackedSource);
      }
    }
  } catch {}
  result.backgroundEnabled = localStorage.getItem(legacyBackgroundKey) === "true";
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(legacyMainBackupPrefix)) keys.push(key);
  }
  for (const key of keys) {
    const login = key.slice(legacyMainBackupPrefix.length).toLowerCase();
    const id = localStorage.getItem(key);
    if (login && id) result.mainBackups[login] = id;
  }
  return result;
}

function removeLegacyKeys(): void {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (
      key === legacySourcesKey ||
      key === legacyBackgroundKey ||
      key?.startsWith(legacyMainBackupPrefix)
    ) {
      keys.push(key);
    }
  }
  for (const key of keys) localStorage.removeItem(key);
}

function getByPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, key) => {
    if (!record(current)) return undefined;
    return current[key];
  }, value);
}

function setByPath(settings: Settings, path: string, value: unknown): Settings {
  const parts = path.split(".").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "plugins") {
    throw new Error("Plugins can only write settings under 'plugins'.");
  }
  const next: Settings = { ...settings, plugins: { ...settings.plugins } };
  let target = next.plugins as Record<string, unknown>;
  for (let index = 1; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const child = target[key];
    if (!record(child)) target[key] = {};
    target = target[key] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
  return next;
}

let settings = $state<Settings>(createDefaultSettings());
let loaded = false;
let settingsFileValid = true;
let loadPromise: Promise<void> | undefined;
let saveQueue: Promise<void> = Promise.resolve();

export function isSettingsLoaded(): boolean {
  return loaded;
}

export function getSettings(): Settings {
  return settings;
}

export function isSettingsFileValid(): boolean {
  return settingsFileValid;
}

export function loadSettings(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const fileExists = await exists("settings.json", { baseDir: BaseDirectory.AppConfig });
      if (fileExists) {
        try {
          const text = await readTextFile("settings.json", {
            baseDir: BaseDirectory.AppConfig,
          });
          settings = parseSettings(JSON.parse(text));
          loaded = true;
          return;
        } catch {
          settingsFileValid = false;
          settings = createDefaultSettings();
          loaded = true;
          return;
        }
      }
    } catch {}
    settings = migrateSettings();
    try {
      const dir = await appConfigDir();
      await mkdir(dir, { recursive: true });
      await writeTextFile("settings.json", JSON.stringify(settings, null, 2), {
        baseDir: BaseDirectory.AppConfig,
      });
      removeLegacyKeys();
    } catch {}
    loaded = true;
  })();
  return loadPromise;
}

export function saveSettings(): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(settings)) as Settings;
  const next = saveQueue.then(async () => {
    const dir = await appConfigDir();
    try {
      await mkdir(dir, { recursive: true });
    } catch {}
    await writeTextFile("settings.json", JSON.stringify(snapshot, null, 2), {
      baseDir: BaseDirectory.AppConfig,
    });
  });
  saveQueue = next.catch(() => {});
  return next;
}

export async function updateSettings(
  updater: (current: Settings) => Settings,
): Promise<void> {
  settings = updater(settings);
  await saveSettings();
}

export function getSetting(path: string): unknown {
  return getByPath(settings, path);
}

export async function setSetting(path: string, value: unknown): Promise<void> {
  const next = setByPath(settings, path, value);
  settings = next;
  await saveSettings();
}

declare global {
  interface Window {
    updainium?: {
      config: {
        get(path: string): unknown;
        set(path: string, value: unknown): Promise<void>;
      };
    };
  }
}

function installConfigApi(): void {
  if (typeof window === "undefined") return;
  window.updainium = {
    ...window.updainium,
    config: {
      get: getSetting,
      set: setSetting,
    },
  };
}

installConfigApi();