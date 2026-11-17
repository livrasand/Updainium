import { BaseDirectory } from "@tauri-apps/api/path";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { registerCommand, type Command } from "./commands";
import { giteaProvider } from "./providers/gitea";
import { githubProvider } from "./providers/github";
import { gitlabProvider } from "./providers/gitlab";
import type { Provider, SourceReference } from "./providers/types";

const builtInProviders = [githubProvider, gitlabProvider, giteaProvider];
let providers: Provider[] = [...builtInProviders];
const loadedPlugins = new Map<string, (() => void)[]>();

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
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  return import(/* @vite-ignore */ url).finally(() => URL.revokeObjectURL(url));
}

export async function listInstalledPlugins(): Promise<string[]> {
  const options = { baseDir: BaseDirectory.AppConfig };
  if (!(await exists("plugins", options))) return [];
  const entries = await readDir("plugins", options);
  return entries
    .filter((entry) => entry.isFile && entry.name.endsWith(".js"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function loadUserPlugins(): Promise<void> {
  const pluginNames = await listInstalledPlugins();
  for (const disposeCommands of loadedPlugins.values()) {
    for (const dispose of disposeCommands) dispose();
  }
  loadedPlugins.clear();
  providers = [...builtInProviders];

  for (const name of pluginNames) {
    const disposeCommands: (() => void)[] = [];
    try {
      const source = await readTextFile(`plugins/${name}`, {
        baseDir: BaseDirectory.AppConfig,
      });
      const module: unknown = await importPlugin(source);
      const candidate = (module as { default?: unknown }).default ?? module;
      registerPluginModule(candidate, disposeCommands);
      loadedPlugins.set(name, disposeCommands);
    } catch {
    }
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