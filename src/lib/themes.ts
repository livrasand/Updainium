import { BaseDirectory } from "@tauri-apps/api/path";
import { copyFile, exists, mkdir, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";

const THEME_STYLE_ID = "updainium-active-theme";
const CUSTOM_STYLE_ID = "updainium-custom-styles";
const BASE_VARS_STYLE_ID = "updainium-base-variables";

const BASE_VARIABLES_CSS = `
:root {
  --up-bg: var(--page);
  --up-surface: var(--surface);
  --up-surface-raised: var(--surface-raised);
  --up-surface-muted: var(--surface-muted);
  --up-text: var(--text);
  --up-muted: var(--muted);
  --up-subtle: var(--subtle);
  --up-border: var(--border);
  --up-accent: var(--accent);
}
body {
  background-color: var(--up-bg);
  color: var(--up-text);
}
`;

function getOrCreateStyleElement(id: string): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  let element = document.getElementById(id) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement("style");
    element.id = id;
    document.head.appendChild(element);
  }
  return element;
}

export function injectBaseVariables(): void {
  const element = getOrCreateStyleElement(BASE_VARS_STYLE_ID);
  if (element) element.textContent = BASE_VARIABLES_CSS;
}

export function injectThemeCss(css: string): void {
  const element = getOrCreateStyleElement(THEME_STYLE_ID);
  if (element) element.textContent = css;
}

export function injectCustomCss(css: string): void {
  const element = getOrCreateStyleElement(CUSTOM_STYLE_ID);
  if (element) element.textContent = css;
}

export async function listInstalledThemes(): Promise<string[]> {
  const themes = new Set<string>();
  const configOptions = { baseDir: BaseDirectory.AppConfig };

  if (await exists("themes", configOptions)) {
    try {
      const entries = await readDir("themes", configOptions);
      for (const entry of entries) {
        if (entry.isFile && entry.name.endsWith(".css")) {
          themes.add(entry.name);
        }
      }
    } catch {}
  }

  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    if (await exists("themes")) {
      try {
        const entries = await readDir("themes");
        for (const entry of entries) {
          if (entry.isFile && entry.name.endsWith(".css")) {
            themes.add(entry.name);
          }
        }
      } catch {}
    }
  }

  return [...themes].sort((left, right) => left.localeCompare(right));
}

export async function getActiveThemeName(): Promise<string | null> {
  const configOptions = { baseDir: BaseDirectory.AppConfig };

  if (await exists("theme", configOptions)) {
    try {
      const content = await readTextFile("theme", configOptions);
      const trimmed = content.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }

  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    if (await exists("theme")) {
      try {
        const content = await readTextFile("theme");
        const trimmed = content.trim();
        return trimmed.length > 0 ? trimmed : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function setActiveTheme(name: string | null): Promise<void> {
  const configOptions = { baseDir: BaseDirectory.AppConfig };

  if (!name) {
    if (await exists("theme", configOptions)) {
      try {
        await remove("theme", configOptions);
      } catch {}
    }
    injectThemeCss("");
    return;
  }

  await writeTextFile("theme", name, configOptions);
  await loadThemeByName(name);
}

async function loadThemeByName(name: string): Promise<boolean> {
  const configOptions = { baseDir: BaseDirectory.AppConfig };
  const targetPath = `themes/${name}`;

  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    if (await exists(targetPath)) {
      try {
        const css = await readTextFile(targetPath);
        injectThemeCss(css);
        return true;
      } catch {}
    }
  }

  if (await exists(targetPath, configOptions)) {
    try {
      const css = await readTextFile(targetPath, configOptions);
      injectThemeCss(css);
      return true;
    } catch {}
  }

  injectThemeCss("");
  return false;
}

export async function loadActiveTheme(): Promise<void> {
  const activeName = await getActiveThemeName();
  if (activeName) {
    await loadThemeByName(activeName);
  } else {
    injectThemeCss("");
  }
}

export async function loadCustomStyles(): Promise<void> {
  const configOptions = { baseDir: BaseDirectory.AppConfig };

  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    if (await exists("styles.css")) {
      try {
        const css = await readTextFile("styles.css");
        injectCustomCss(css);
        return;
      } catch {}
    }
  }

  if (await exists("styles.css", configOptions)) {
    try {
      const css = await readTextFile("styles.css", configOptions);
      injectCustomCss(css);
      return;
    } catch {}
  }

  injectCustomCss("");
}

export async function loadInitScript(): Promise<void> {
  const configOptions = { baseDir: BaseDirectory.AppConfig };
  let scriptContent = "";

  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    if (await exists("init.js")) {
      try {
        scriptContent = await readTextFile("init.js");
      } catch {}
    }
  }

  if (!scriptContent && (await exists("init.js", configOptions))) {
    try {
      scriptContent = await readTextFile("init.js", configOptions);
    } catch {}
  }

  if (scriptContent.trim()) {
    try {
      const runner = new Function(scriptContent);
      runner();
    } catch {}
  }
}

export async function installLocalTheme(sourcePath: string): Promise<string> {
  const name = sourcePath.split(/[\\/]/).pop();
  if (!name || !name.endsWith(".css")) throw new Error("Choose a .css theme file.");
  await mkdir("themes", { baseDir: BaseDirectory.AppConfig, recursive: true });
  await copyFile(sourcePath, `themes/${name}`, { toPathBaseDir: BaseDirectory.AppConfig });
  await setActiveTheme(name);
  return name;
}

export async function uninstallTheme(name: string): Promise<void> {
  const active = await getActiveThemeName();
  if (active === name) {
    await setActiveTheme(null);
  }
  await remove(`themes/${name}`, { baseDir: BaseDirectory.AppConfig });
}

export async function initThemeSystem(): Promise<void> {
  injectBaseVariables();
  await loadActiveTheme();
  await loadCustomStyles();
  await loadInitScript();
}
