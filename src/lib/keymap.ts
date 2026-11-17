import { BaseDirectory } from "@tauri-apps/api/path";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export type Keymap = Record<string, string>;

export const defaultKeymap: Keymap = {
  "command.palette": "mod+shift+p",
  "source.check": "ctrl+shift+u",
};

export const isMac =
  typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCombo(input: string): string {
  const parts = input
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop() ?? "";
  if (!key) return "";
  const modifiers = new Set(parts);
  if (modifiers.has("cmd") || modifiers.has("command")) modifiers.add("meta");
  if (modifiers.has("mod")) {
    if (isMac) modifiers.add("meta");
    else modifiers.add("ctrl");
  }
  const ordered = ["meta", "ctrl", "alt", "shift"].filter((modifier) =>
    modifiers.has(modifier),
  );
  ordered.push(key === " " ? "space" : key);
  return ordered.join("+");
}

export function normalizeKeymap(input: unknown): Keymap {
  if (!record(input)) return {};
  const result: Keymap = {};
  for (const [command, binding] of Object.entries(input)) {
    if (typeof binding !== "string") continue;
    const normalized = normalizeCombo(binding);
    if (normalized) result[command] = normalized;
  }
  return result;
}

export async function loadKeymap(): Promise<Keymap> {
  const defaults = normalizeKeymap(defaultKeymap);
  try {
    const fileExists = await exists("keymap.json", { baseDir: BaseDirectory.AppConfig });
    if (!fileExists) {
      try {
        await writeTextFile("keymap.json", JSON.stringify(defaults, null, 2), {
          baseDir: BaseDirectory.AppConfig,
        });
      } catch {}
      return defaults;
    }
    const text = await readTextFile("keymap.json", { baseDir: BaseDirectory.AppConfig });
    return { ...defaults, ...normalizeKeymap(JSON.parse(text)) };
  } catch {
    return defaults;
  }
}

let activeKeymap: Keymap = {};
let pluginKeymap: Keymap = {};

export function registerKeybinding(command: string, combo: string): () => void {
  const normalized = normalizeCombo(combo);
  if (!normalized) return () => {};
  pluginKeymap[command] = normalized;
  activeKeymap[command] = normalized;
  return () => {
    delete pluginKeymap[command];
    delete activeKeymap[command];
  };
}

export async function initKeymap(): Promise<Keymap> {
  const loaded = await loadKeymap();
  activeKeymap = { ...pluginKeymap, ...loaded };
  return activeKeymap;
}

export function getActiveKeymap(): Keymap {
  return activeKeymap;
}

export async function saveKeymap(keymap: Keymap): Promise<void> {
  await writeTextFile("keymap.json", JSON.stringify(normalizeKeymap(keymap), null, 2), {
    baseDir: BaseDirectory.AppConfig,
  });
}

export function eventToCombo(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push("meta");
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  const key = event.key === " " ? "space" : event.key.toLowerCase();
  parts.push(key);
  return normalizeCombo(parts.join("+"));
}

export function findCommandForKeymap(keymap: Keymap, combo: string): string | undefined {
  for (const [command, binding] of Object.entries(keymap)) {
    if (binding === combo) return command;
  }
  return undefined;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}
