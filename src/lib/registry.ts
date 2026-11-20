import { BaseDirectory } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { registerCommand, type Command } from "./commands";
import { isMac, registerKeybinding } from "./keymap";
import { giteaProvider } from "./providers/gitea";
import { githubProvider } from "./providers/github";
import { gitlabProvider } from "./providers/gitlab";
import type { Provider, SourceReference } from "./providers/types";

export type PluginManifest = {
  id: string;
  version?: string;
  engines?: {
    updainium?: string;
    [key: string]: string | undefined;
  };
  main?: string;
  contributes?: {
    providers?: (string | Provider)[];
    commands?: (
      | string
      | Command
      | {
          id?: string;
          command?: string;
          title: string;
          category?: string;
          keywords?: string[];
          when?: () => boolean;
          run?: () => void | Promise<void>;
        }
    )[];
    keybindings?:
      | (
          | string
          | {
              command?: string;
              id?: string;
              key?: string;
              binding?: string;
              combo?: string;
              mac?: string;
            }
        )[]
      | Record<string, string>;
  };
};

type PluginLocation = {
  dir: string;
  options?: { baseDir?: BaseDirectory };
};

const APP_VERSION = "1.5.2";
const builtInProviders = [githubProvider, gitlabProvider, giteaProvider];
let providers: Provider[] = [...builtInProviders];
const loadedPlugins = new Map<string, (() => void)[]>();

export function satisfiesEngine(appVersion: string, requirement: string): boolean {
  const req = requirement.trim();
  if (!req || req === "*") return true;
  const parse = (v: string) =>
    v
      .replace(/^[^\d.]*/, "")
      .split(".")
      .map((part) => {
        const num = parseInt(part, 10);
        return Number.isNaN(num) ? 0 : num;
      });
  const [appMajor = 0, appMinor = 0, appPatch = 0] = parse(appVersion);
  const [reqMajor = 0, reqMinor = 0, reqPatch = 0] = parse(req);

  if (req.startsWith("^")) {
    if (appMajor !== reqMajor) return false;
    if (appMinor < reqMinor) return false;
    if (appMinor === reqMinor && appPatch < reqPatch) return false;
    return true;
  }
  if (req.startsWith("~")) {
    if (appMajor !== reqMajor || appMinor !== reqMinor) return false;
    return appPatch >= reqPatch;
  }
  if (req.startsWith(">=")) {
    if (appMajor > reqMajor) return true;
    if (appMajor === reqMajor && appMinor > reqMinor) return true;
    return appMajor === reqMajor && appMinor === reqMinor && appPatch >= reqPatch;
  }
  if (req.startsWith(">")) {
    if (appMajor > reqMajor) return true;
    if (appMajor === reqMajor && appMinor > reqMinor) return true;
    return appMajor === reqMajor && appMinor === reqMinor && appPatch > reqPatch;
  }
  if (req.startsWith("<=")) {
    if (appMajor < reqMajor) return true;
    if (appMajor === reqMajor && appMinor < reqMinor) return true;
    return appMajor === reqMajor && appMinor === reqMinor && appPatch <= reqPatch;
  }
  return appMajor === reqMajor && appMinor === reqMinor && appPatch === reqPatch;
}

export function registerProvider(provider: Provider): void {
  const index = providers.findIndex((item) => item.id === provider.id);
  if (index >= 0) providers[index] = provider;
  else providers.unshift(provider);
}

function isProvider(value: unknown): value is Provider {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Provider>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.match === "function" &&
    typeof candidate.reference === "function" &&
    typeof candidate.repoApiUrl === "function" &&
    typeof candidate.releaseApiUrls === "function" &&
    typeof candidate.normalize === "function"
  );
}

function isCommand(value: unknown): value is Command {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Command>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.title === "string" &&
    candidate.title.length > 0 &&
    typeof candidate.run === "function" &&
    (candidate.category === undefined || typeof candidate.category === "string") &&
    (candidate.keywords === undefined ||
      (Array.isArray(candidate.keywords) &&
        candidate.keywords.every((keyword) => typeof keyword === "string"))) &&
    (candidate.when === undefined || typeof candidate.when === "function")
  );
}

function registerPluginModule(
  module: unknown,
  disposeCommands: (() => void)[],
): void {
  if (Array.isArray(module)) {
    for (const item of module) registerPluginModule(item, disposeCommands);
    return;
  }
  if (!module || typeof module !== "object") return;
  const candidate = module as { providers?: unknown; commands?: unknown };
  if (candidate.providers !== undefined || candidate.commands !== undefined) {
    if (Array.isArray(candidate.providers)) {
      for (const provider of candidate.providers) {
        if (isProvider(provider)) registerProvider(provider);
      }
    }
    if (Array.isArray(candidate.commands)) {
      for (const command of candidate.commands) {
        if (isCommand(command)) disposeCommands.push(registerCommand(command));
      }
    }
    return;
  }
  if (isProvider(module)) registerProvider(module);
  else if (isCommand(module)) disposeCommands.push(registerCommand(module));
}

function importPlugin(source: string): Promise<unknown> {
  if (
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof window !== "undefined"
  ) {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    return import(/* @vite-ignore */ url).finally(() => URL.revokeObjectURL(url));
  }
  const encoded =
    typeof Buffer !== "undefined"
      ? Buffer.from(source).toString("base64")
      : btoa(unescape(encodeURIComponent(source)));
  return import(/* @vite-ignore */ `data:text/javascript;base64,${encoded}`);
}

async function loadManifestPlugin(
  pluginDir: string,
  manifest: PluginManifest,
  options: { baseDir?: BaseDirectory } | undefined,
  disposers: (() => void)[],
): Promise<void> {
  async function readSource(relativePath: string): Promise<string> {
    const cleanPath = relativePath.replace(/^\/+/, "");
    const fullPath = `${pluginDir}/${cleanPath}`;
    return options?.baseDir
      ? readTextFile(fullPath, { baseDir: options.baseDir })
      : readTextFile(fullPath);
  }

  let mainExports: unknown = undefined;
  const mainFile = manifest.main ?? "index.js";
  const mainExists = options?.baseDir
    ? await exists(`${pluginDir}/${mainFile}`, { baseDir: options.baseDir })
    : await exists(`${pluginDir}/${mainFile}`);

  if (mainExists) {
    try {
      const source = await readSource(mainFile);
      const mod = await importPlugin(source);
      mainExports = (mod as { default?: unknown })?.default ?? mod;
      registerPluginModule(mainExports, disposers);
      if (typeof mainExports === "function") {
        mainExports();
      } else if (
        mainExports &&
        typeof mainExports === "object" &&
        typeof (mainExports as { activate?: unknown }).activate === "function"
      ) {
        (mainExports as { activate: () => void }).activate();
      }
    } catch {}
  }

  if (manifest.contributes?.providers && Array.isArray(manifest.contributes.providers)) {
    for (const item of manifest.contributes.providers) {
      if (typeof item === "string") {
        try {
          const source = await readSource(item);
          const mod = await importPlugin(source);
          const candidate = (mod as { default?: unknown })?.default ?? mod;
          if (isProvider(candidate)) registerProvider(candidate);
          else if (Array.isArray(candidate)) {
            for (const p of candidate) if (isProvider(p)) registerProvider(p);
          } else if (
            candidate &&
            typeof candidate === "object" &&
            Array.isArray((candidate as { providers?: unknown }).providers)
          ) {
            for (const p of (candidate as { providers: unknown[] }).providers) {
              if (isProvider(p)) registerProvider(p);
            }
          }
        } catch {}
      } else if (isProvider(item)) {
        registerProvider(item);
      }
    }
  }

  if (manifest.contributes?.commands && Array.isArray(manifest.contributes.commands)) {
    for (const item of manifest.contributes.commands) {
      if (typeof item === "string") {
        try {
          const source = await readSource(item);
          const mod = await importPlugin(source);
          const candidate = (mod as { default?: unknown })?.default ?? mod;
          if (isCommand(candidate)) disposers.push(registerCommand(candidate));
          else if (Array.isArray(candidate)) {
            for (const c of candidate) if (isCommand(c)) disposers.push(registerCommand(c));
          } else if (
            candidate &&
            typeof candidate === "object" &&
            Array.isArray((candidate as { commands?: unknown }).commands)
          ) {
            for (const c of (candidate as { commands: unknown[] }).commands) {
              if (isCommand(c)) disposers.push(registerCommand(c));
            }
          }
        } catch {}
      } else if (isCommand(item)) {
        disposers.push(registerCommand(item));
      } else if (item && typeof item === "object") {
        const def = item as Record<string, unknown>;
        const cmdId =
          typeof def.id === "string"
            ? def.id
            : typeof def.command === "string"
              ? def.command
              : "";
        const title = typeof def.title === "string" ? def.title : "";
        let runFn: (() => void | Promise<void>) | undefined =
          typeof def.run === "function" ? (def.run as () => void) : undefined;

        if (!runFn && mainExports && typeof mainExports === "object") {
          const exp = mainExports as Record<string, unknown>;
          const runs = (exp.commands ?? exp.runs ?? exp) as Record<string, unknown>;
          if (typeof runs[cmdId] === "function") {
            runFn = runs[cmdId] as () => void;
          } else if (typeof exp.run === "function") {
            runFn = () => (exp.run as (id: string) => void)(cmdId);
          }
        }

        if (cmdId && title && runFn) {
          disposers.push(
            registerCommand({
              id: cmdId,
              title,
              category: typeof def.category === "string" ? def.category : undefined,
              keywords:
                Array.isArray(def.keywords) &&
                def.keywords.every((k) => typeof k === "string")
                  ? (def.keywords as string[])
                  : undefined,
              when: typeof def.when === "function" ? (def.when as () => boolean) : undefined,
              run: runFn,
            }),
          );
        }
      }
    }
  }

  if (manifest.contributes?.keybindings) {
    const kb = manifest.contributes.keybindings;
    if (Array.isArray(kb)) {
      for (const item of kb) {
        if (typeof item === "string") {
          try {
            const source = await readSource(item);
            const parsed = JSON.parse(source);
            if (parsed && typeof parsed === "object") {
              for (const [cmd, combo] of Object.entries(parsed)) {
                if (typeof combo === "string") disposers.push(registerKeybinding(cmd, combo));
              }
            }
          } catch {}
        } else if (item && typeof item === "object") {
          const def = item as Record<string, unknown>;
          const cmd =
            typeof def.command === "string"
              ? def.command
              : typeof def.id === "string"
                ? def.id
                : "";
          const combo =
            isMac && typeof def.mac === "string"
              ? def.mac
              : typeof def.key === "string"
                ? def.key
                : typeof def.binding === "string"
                  ? def.binding
                  : typeof def.combo === "string"
                    ? def.combo
                    : "";
          if (cmd && combo) {
            disposers.push(registerKeybinding(cmd, combo));
          }
        }
      }
    } else if (typeof kb === "object") {
      for (const [cmd, combo] of Object.entries(kb)) {
        if (typeof combo === "string") {
          disposers.push(registerKeybinding(cmd, combo));
        }
      }
    }
  }
}

async function findPluginsInLocation(
  location: PluginLocation,
  appVersion: string,
): Promise<{ id: string; load: () => Promise<void> }[]> {
  const { dir, options } = location;
  const dirExists = options?.baseDir
    ? await exists(dir, { baseDir: options.baseDir })
    : await exists(dir);
  if (!dirExists) return [];

  const results: { id: string; load: () => Promise<void> }[] = [];

  const selfManifestPath = `${dir}/updainium.json`;
  const hasSelfManifest = options?.baseDir
    ? await exists(selfManifestPath, { baseDir: options.baseDir })
    : await exists(selfManifestPath);

  if (hasSelfManifest) {
    try {
      const text = options?.baseDir
        ? await readTextFile(selfManifestPath, { baseDir: options.baseDir })
        : await readTextFile(selfManifestPath);
      const manifest = JSON.parse(text) as PluginManifest;
      if (
        manifest?.id &&
        (!manifest.engines?.updainium || satisfiesEngine(appVersion, manifest.engines.updainium))
      ) {
        results.push({
          id: manifest.id,
          load: async () => {
            const disposers: (() => void)[] = [];
            await loadManifestPlugin(dir, manifest, options, disposers);
            loadedPlugins.set(manifest.id, disposers);
          },
        });
        return results;
      }
    } catch {}
  }

  const entries = options?.baseDir
    ? await readDir(dir, { baseDir: options.baseDir })
    : await readDir(dir);

  for (const entry of entries) {
    const subManifestPath = `${dir}/${entry.name}/updainium.json`;
    const hasSubManifest = options?.baseDir
      ? await exists(subManifestPath, { baseDir: options.baseDir })
      : await exists(subManifestPath);

    if (hasSubManifest) {
      try {
        const text = options?.baseDir
          ? await readTextFile(subManifestPath, { baseDir: options.baseDir })
          : await readTextFile(subManifestPath);
        const manifest = JSON.parse(text) as PluginManifest;
        if (
          manifest?.id &&
          (!manifest.engines?.updainium || satisfiesEngine(appVersion, manifest.engines.updainium))
        ) {
          results.push({
            id: manifest.id,
            load: async () => {
              const disposers: (() => void)[] = [];
              await loadManifestPlugin(`${dir}/${entry.name}`, manifest, options, disposers);
              loadedPlugins.set(manifest.id, disposers);
            },
          });
          continue;
        }
      } catch {}
    }

    if (entry.isFile && entry.name.endsWith(".js")) {
      results.push({
        id: entry.name,
        load: async () => {
          const disposers: (() => void)[] = [];
          const source = options?.baseDir
            ? await readTextFile(`${dir}/${entry.name}`, { baseDir: options.baseDir })
            : await readTextFile(`${dir}/${entry.name}`);
          const mod: unknown = await importPlugin(source);
          const candidate = (mod as { default?: unknown })?.default ?? mod;
          registerPluginModule(candidate, disposers);
          loadedPlugins.set(entry.name, disposers);
        },
      });
    }
  }

  return results;
}

export async function listInstalledPlugins(): Promise<string[]> {
  const locations: PluginLocation[] = [];

  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    const devDir = (import.meta.env.VITE_DEV_PLUGINS_DIR as string | undefined) || "plugins";
    locations.push({ dir: devDir, options: undefined });
  }

  locations.push({ dir: "plugins", options: { baseDir: BaseDirectory.AppConfig } });

  const pluginIds: string[] = [];

  for (const location of locations) {
    try {
      const plugins = await findPluginsInLocation(location, APP_VERSION);
      for (const plugin of plugins) {
        if (!pluginIds.includes(plugin.id)) {
          pluginIds.push(plugin.id);
        }
      }
    } catch {}
  }

  return pluginIds.sort((left, right) => left.localeCompare(right));
}

export async function loadUserPlugins(): Promise<void> {
  for (const disposeCommands of loadedPlugins.values()) {
    for (const dispose of disposeCommands) dispose();
  }
  loadedPlugins.clear();
  providers = [...builtInProviders];

  const locations: PluginLocation[] = [];

  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    const devDir = (import.meta.env.VITE_DEV_PLUGINS_DIR as string | undefined) || "plugins";
    locations.push({ dir: devDir, options: undefined });
  }

  locations.push({ dir: "plugins", options: { baseDir: BaseDirectory.AppConfig } });

  const seenIds = new Set<string>();

  for (const location of locations) {
    try {
      const plugins = await findPluginsInLocation(location, APP_VERSION);
      for (const plugin of plugins) {
        if (seenIds.has(plugin.id)) continue;
        seenIds.add(plugin.id);
        try {
          await plugin.load();
        } catch {}
      }
    } catch {}
  }
}

export function resolveProvider(input: string | URL): {
  provider: Provider;
  reference: SourceReference;
} {
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
