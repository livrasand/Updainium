<script lang="ts">
  import { onMount } from "svelte";
  import { fly } from "svelte/transition";
  import type { Snippet } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { setDockVisibility } from "@tauri-apps/api/app";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import { copyFile, exists, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
  import { appConfigDir, BaseDirectory } from "@tauri-apps/api/path";
  import { openPath } from "@tauri-apps/plugin-opener";
  import CommandPalette from "$lib/CommandPalette.svelte";
  import { registerCommand, executeCommand } from "$lib/commands";
  import { listInstalledPlugins, loadUserPlugins } from "$lib/registry";
  import { hideSnackbar, showSnackbar, snackbar } from "$lib/snackbar.svelte";
  import {
    eventToCombo,
    findCommandForKeymap,
    getActiveKeymap,
    initKeymap,
    isEditableTarget,
  } from "$lib/keymap";
  import { getSettings, loadSettings } from "$lib/settings.svelte";

  let { children }: { children: Snippet } = $props();

  onMount(() => {
    const window = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void loadSettings().then(() =>
      invoke("set_background_mode", {
        enabled: getSettings().backgroundEnabled,
      }).catch((error: unknown) => {
        showSnackbar(
          `Could not apply background settings: ${error instanceof Error ? error.message : String(error)}`,
          6000,
          "error",
        );
      }),
    );

    void window
      .onCloseRequested((event) => {
        if (getSettings().backgroundEnabled) {
          event.preventDefault();
          void setDockVisibility(false);
          void window.hide();
        }
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  onMount(() => {
    function onWindowKeydown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) return;
      const command = findCommandForKeymap(getActiveKeymap(), eventToCombo(event));
      if (!command) return;
      event.preventDefault();
      void executeCommand(command).catch(() => {});
    }
    window.addEventListener("keydown", onWindowKeydown);
    void initKeymap();
    return () => window.removeEventListener("keydown", onWindowKeydown);
  });

  onMount(() => {
    const disposers = [
      registerCommand({
        id: "plugins.installLocal",
        title: "Install local plugin…",
        category: "Plugins",
        keywords: ["plugin", "add", "js"],
        run: installLocalPlugin,
      }),
      registerCommand({
        id: "plugins.listInstalled",
        title: "List installed plugins",
        category: "Plugins",
        keywords: ["plugin", "installed", "show"],
        run: listPlugins,
      }),
      registerCommand({
        id: "plugins.uninstall",
        title: "Uninstall plugin…",
        category: "Plugins",
        keywords: ["plugin", "remove", "delete"],
        run: uninstallPlugin,
      }),
      registerCommand({
        id: "config.openSettingsJson",
        title: "Open settings.json",
        category: "Advanced",
        keywords: ["config", "json", "raw"],
        run: () => openConfigFile("settings.json"),
      }),
      registerCommand({
        id: "config.openKeymapJson",
        title: "Open keymap.json",
        category: "Advanced",
        keywords: ["config", "json", "shortcuts", "raw"],
        run: () => openConfigFile("keymap.json"),
      }),
    ];
    return () => disposers.forEach((dispose) => dispose());
  });

  async function openConfigFile(name: "settings.json" | "keymap.json"): Promise<void> {
    const dir = await appConfigDir();
    const filePath = `${dir}/${name}`;
    if (!(await exists(filePath))) {
      await mkdir(dir, { recursive: true });
      await writeTextFile(filePath, "{}");
    }
    await openPath(filePath);
  }

  async function listPlugins(): Promise<void> {
    const plugins = await listInstalledPlugins();
    showSnackbar(
      plugins.length ? `Installed plugins:\n${plugins.join("\n")}` : "No plugins are installed.",
      10000,
    );
  }

  async function uninstallPlugin(): Promise<void> {
    const plugins = await listInstalledPlugins();
    if (!plugins.length) {
      showSnackbar("No plugins are installed.");
      return;
    }

    const configDirectory = await appConfigDir();
    const pluginDirectory = `${configDirectory.replace(/[\\/]+$/, "")}/plugins`;
    const selected = await openFileDialog({
      defaultPath: pluginDirectory,
      multiple: false,
      filters: [{ name: "Installed JavaScript plugin", extensions: ["js"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    const selectedPath = selected.replace(/\\/g, "/");
    const pluginPathPrefix = `${pluginDirectory.replace(/\\/g, "/")}/`;
    const name = selectedPath.startsWith(pluginPathPrefix)
      ? selectedPath.slice(pluginPathPrefix.length)
      : "";
    if (!name || name.includes("/") || !plugins.includes(name)) {
      throw new Error("Choose a plugin from the installed plugins folder.");
    }
    if (!confirm(`Uninstall ${name}? Its commands and providers will stop loading.`)) return;

    await remove(`plugins/${name}`, { baseDir: BaseDirectory.AppConfig });
    await loadUserPlugins();
    showSnackbar(`Plugin uninstalled: ${name}`);
  }

  async function installLocalPlugin(): Promise<void> {
    const selected = await openFileDialog({
      multiple: false,
      filters: [{ name: "JavaScript plugin", extensions: ["js"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    const name = selected.split(/[\\/]/).pop();
    if (!name) throw new Error("Choose a .js plugin file.");
    await mkdir("plugins", { baseDir: BaseDirectory.AppConfig, recursive: true });
    await copyFile(selected, `plugins/${name}`, { toPathBaseDir: BaseDirectory.AppConfig });
    await loadUserPlugins();
    showSnackbar(`Plugin installed and loaded: ${name}`);
  }
</script>

{@render children()}
<CommandPalette />
{#if snackbar.open}
  <div
    class="snackbar"
    class:error={snackbar.kind === "error"}
    role={snackbar.kind === "error" ? "alert" : "status"}
    aria-live={snackbar.kind === "error" ? "assertive" : "polite"}
    aria-atomic="true"
    transition:fly={{ y: 16, duration: 200 }}
  >
    <span class="snackbar-label">{snackbar.message}</span>
    <button class="snackbar-action" type="button" onclick={hideSnackbar}>Dismiss</button>
  </div>
{/if}

<style>
  .snackbar { position: fixed; right: 0; bottom: 24px; left: 0; z-index: 60; display: flex; width: fit-content; max-width: min(560px, calc(100vw - 40px)); max-height: 60vh; align-items: center; gap: 8px; margin: 0 auto; overflow-y: auto; padding: 12px 10px 12px 18px; border-radius: 10px; background: #2f2b36; box-shadow: 0 8px 24px rgb(24 19 32 / 28%); color: #f4f1f8; font: 13px/1.45 "Roboto", "Segoe UI", sans-serif; white-space: pre-line; }
  .snackbar.error { background: #7f2c2c; color: #fff; }
  .snackbar-label { min-width: 0; }
  .snackbar-action { flex: 0 0 auto; padding: 8px 14px; border: 0; border-radius: 7px; background: transparent; color: #d2b7ff; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
  .snackbar.error .snackbar-action { color: #ffe0e0; }
  .snackbar-action:hover { background: rgb(255 255 255 / 10%); }
  .snackbar-action:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
