<script lang="ts">
  import { onMount, tick } from "svelte";
  import { beforeNavigate } from "$app/navigation";
  import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { createBackup, parseBackup, parseGistId, restoreSources, sourcesKey, type Backup } from "$lib/backup";
  import { cacheGists, clearCachedGists, readCachedGists, chooseMainBackup, mainBackupKey, type Gist, type GistRevision } from "$lib/gists";

  const backgroundKey = "updainium.background.v1";
  let backgroundEnabled = $state(false);
  let startOnLogin = $state(false);
  let ready = $state(false);
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);
  let githubBusy = $state(false);
  let githubError = $state("");
  let githubNotice = $state("");
  let connectionStatus = $state("");
  let githubDialog = $state<HTMLDialogElement>();
  let githubAttempt = 0;
  let cancellingGithub = $state(false);

  $effect(() => {
    if (!githubDialog) return;
    if (githubBusy && !githubDialog.open) githubDialog.showModal();
    else if (!githubBusy && githubDialog.open) githubDialog.close();
  });
  let pendingBackup = $state<Backup | null>(null);
  let importMode = $state<"merge" | "replace">("merge");
  let applyPreferences = $state(true);
  let login = $state("");
  let accessToken = $state("");
  let gists = $state<Gist[]>([]);
  let backupsLoaded = $state(false);
  let selectedGist = $state("");
  const mainBackup = $derived(gists.find((gist) => gist.id === selectedGist));
  let confirmUpload = $state(false);
  let expectedRevision = $state("");
  let showRestore = $state(false);
  let revisions = $state<GistRevision[]>([]);
  let selectedRevision = $state("");
  let gistVisibility = $state<"secret" | "public">("secret");
  let sharedGist = $state("");

  beforeNavigate((navigation) => {
    if (busy) navigation.cancel();
  });

  onMount(() => {
    let disposed = false;
    void invoke<{ login: string } | null>("github_status").then((account) => {
      if (disposed || !account) return;
      login = account.login;
      const cached = readCachedGists(login);
      if (cached !== undefined) {
        gists = cached;
        backupsLoaded = true;
        selectMainBackup(chooseMainBackup(gists, localStorage.getItem(mainBackupKey(login))));
      }
    }).catch((cause) => { if (!disposed) githubError = messageOf(cause); });
    return () => {
      disposed = true;
    };
  });

  function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    notice = "";
    try { await action(); }
    catch (cause) { error = messageOf(cause); }
    finally { busy = false; }
  }

  async function runGithub(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    const attempt = ++githubAttempt;
    busy = true;
    githubBusy = true;
    githubError = "";
    githubNotice = "";
    error = "";
    notice = "";
    connectionStatus = "Connecting to GitHub…";
    try {
      await action();
      if (attempt === githubAttempt) githubNotice = notice;
    } catch (cause) {
      if (attempt === githubAttempt) {
        githubError = messageOf(cause);
        error = githubError;
      }
    } finally {
      if (attempt === githubAttempt) {
        connectionStatus = "";
        githubBusy = false;
        busy = false;
      }
    }
  }

  async function cancelGithub(): Promise<void> {
    if (cancellingGithub) return;
    cancellingGithub = true;
    githubAttempt++;
    try {
      await invoke("github_cancel_request");
      githubNotice = connectionStatus.startsWith("Uploading")
        ? "Cancelled. An upload already received by GitHub may still have been saved."
        : "Cancelled.";
    } catch (cause) {
      githubError = messageOf(cause);
    } finally {
      connectionStatus = "";
      githubBusy = false;
      busy = false;
      cancellingGithub = false;
    }
  }

  async function backupContent(): Promise<string> {
    return JSON.stringify(createBackup(localStorage, await isEnabled()), null, 2);
  }

  async function exportJson(): Promise<void> {
    const saved = await invoke<boolean>("export_settings_file", { content: await backupContent() });
    if (saved) notice = "JSON backup saved.";
  }

  function previewImport(content: string, preferences = true): void {
    pendingBackup = parseBackup(content);
    importMode = "merge";
    applyPreferences = preferences;
    void tick().then(() => document.getElementById("preview-heading")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function importJson(): Promise<void> {
    const content = await invoke<string | null>("import_settings_file");
    if (content !== null) previewImport(content);
  }

  async function applyImport(): Promise<void> {
    if (!pendingBackup) return;
    const backup = pendingBackup;
    const oldSources = localStorage.getItem(sourcesKey);
    const oldBackground = localStorage.getItem(backgroundKey);
    const previousAutostart = await isEnabled();
    const previousBackground = oldBackground === "true";
    const current = importMode === "merge" ? JSON.parse(oldSources ?? "[]") : [];
    const nextSources = restoreSources(backup, current, importMode);
    // Prepare serialization before changing local or operating-system settings.
    const serialized = JSON.stringify(nextSources);
    try {
      if (applyPreferences) {
        if (backup.settings.startOnLogin) await enable(); else await disable();
        await invoke("set_background_mode", { enabled: backup.settings.backgroundEnabled });
        localStorage.setItem(backgroundKey, String(backup.settings.backgroundEnabled));
      }
      localStorage.setItem(sourcesKey, serialized);
    } catch (cause) {
      const rollbackErrors: string[] = [];
      try {
        if (oldSources === null) localStorage.removeItem(sourcesKey); else localStorage.setItem(sourcesKey, oldSources);
        if (oldBackground === null) localStorage.removeItem(backgroundKey); else localStorage.setItem(backgroundKey, oldBackground);
      } catch (rollback) { rollbackErrors.push(messageOf(rollback)); }
      if (applyPreferences) {
        for (const restore of [
          () => previousAutostart ? enable() : disable(),
          () => invoke("set_background_mode", { enabled: previousBackground }),
        ]) {
          try { await restore(); } catch (rollback) { rollbackErrors.push(messageOf(rollback)); }
        }
      }
      throw new Error(`Import failed: ${messageOf(cause)}${rollbackErrors.length ? ` Some settings could not be restored: ${rollbackErrors.join("; ")}` : " Your previous settings were restored."}`);
    }
    if (applyPreferences) {
      backgroundEnabled = backup.settings.backgroundEnabled;
      startOnLogin = backup.settings.startOnLogin;
    }
    pendingBackup = null;
    notice = `Import complete. ${nextSources.length} apps in your catalog. Return to Apps to check their releases on this computer.`;
  }

  async function loadGists(): Promise<void> {
    connectionStatus = "Connecting to GitHub and loading backups…";
    const attempt = githubAttempt;
    const loaded = await invoke<Gist[]>("github_list_backups");
    if (attempt !== githubAttempt) return;
    gists = loaded;
    cacheGists(login, loaded);
    backupsLoaded = true;
    const remembered = localStorage.getItem(mainBackupKey(login));
    selectMainBackup(chooseMainBackup(gists, remembered));
  }

  function selectMainBackup(id: string): void {
    selectedGist = id;
    confirmUpload = false;
    expectedRevision = "";
    showRestore = false;
    revisions = [];
    selectedRevision = "";
    if (id) localStorage.setItem(mainBackupKey(login), id);
    else localStorage.removeItem(mainBackupKey(login));
  }

  async function prepareUpdate(): Promise<void> {
    const attempt = githubAttempt;
    connectionStatus = "Checking the latest backup on GitHub…";
    const info = await invoke<{ gist: Gist; revision: string }>("github_backup_info", { id: selectedGist });
    if (attempt !== githubAttempt) return;
    gists = gists.map((gist) => gist.id === info.gist.id ? info.gist : gist);
    cacheGists(login, gists);
    expectedRevision = info.revision;
    confirmUpload = true;
  }

  async function prepareRestore(): Promise<void> {
    const attempt = githubAttempt;
    connectionStatus = "Loading backup revision history from GitHub…";
    const history = await invoke<GistRevision[]>("github_backup_history", { id: selectedGist });
    if (attempt !== githubAttempt) return;
    revisions = history;
    selectedRevision = "";
    showRestore = true;
  }

  async function connectToken(): Promise<void> {
    const attempt = githubAttempt;
    const token = accessToken.trim();
    connectionStatus = "Validating your token and saving sign-in. If macOS asks for Keychain access, allow it to continue.";
    const account = await invoke<{ login: string }>("github_connect_token", { accessToken: token });
    if (attempt !== githubAttempt) return;
    accessToken = "";
    login = account.login;
    connectionStatus = `Connected as ${login}. Loading backups…`;
    await loadGists();
    notice = `Connected as ${login}.`;
  }

  async function disconnect(): Promise<void> {
    await invoke("github_disconnect");
    clearCachedGists(login);
    login = "";
    accessToken = "";
    gists = [];
    backupsLoaded = false;
    selectedGist = "";
    confirmUpload = false;
    showRestore = false;
    revisions = [];
    expectedRevision = "";
    notice = "Disconnected from GitHub on this device.";
  }

  async function openGist(input: string): Promise<void> {
    await openUrl(`https://gist.github.com/${parseGistId(input)}`);
  }

  async function uploadGist(id: string | null): Promise<void> {
    const attempt = githubAttempt;
    connectionStatus = "Uploading your backup to GitHub…";
    const content = await backupContent();
    if (attempt !== githubAttempt) return;
    const gist = await invoke<Gist>("github_write_backup", { id, content, isPublic: gistVisibility === "public", expectedRevision: id ? expectedRevision : null });
    if (attempt !== githubAttempt) return;
    confirmUpload = false;
    selectMainBackup(gist.id);
    await loadGists();
    notice = `Backup saved to a ${gist.public ? "public" : "secret"} GitHub gist: https://gist.github.com/${gist.id}`;
  }

  async function downloadGist(): Promise<void> {
    const attempt = githubAttempt;
    connectionStatus = "Downloading your backup from GitHub…";
    const content = await invoke<string>("github_read_backup", { id: parseGistId(selectedGist), revision: selectedRevision || null });
    if (attempt === githubAttempt) previewImport(content);
  }

  async function importSharedGist(): Promise<void> {
    const attempt = githubAttempt;
    connectionStatus = "Downloading the shared gist from GitHub…";
    const content = await invoke<string>("github_read_backup", { id: parseGistId(sharedGist) });
    if (attempt === githubAttempt) previewImport(content, false);
  }

  onMount(async () => {
    backgroundEnabled = localStorage.getItem(backgroundKey) === "true";
    try {
      startOnLogin = await isEnabled();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      ready = true;
    }
  });

  async function setBackgroundEnabled(enabled: boolean): Promise<void> {
    error = "";
    try {
      await invoke("set_background_mode", { enabled });
      localStorage.setItem(backgroundKey, String(enabled));
      backgroundEnabled = enabled;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function setStartOnLogin(enabled: boolean): Promise<void> {
    error = "";
    try {
      if (enabled) await enable();
      else await disable();
      startOnLogin = enabled;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<svelte:head>
  <title>Updainium — Settings</title>
  <meta name="description" content="Configure how Updainium starts and runs." />
</svelte:head>

{#snippet backupVisibility()}
  <label class="field">Backup visibility
    <select bind:value={gistVisibility} disabled={busy}>
      <option value="secret">Secret — unlisted, readable by anyone with the link</option>
      <option value="public">Public — visible to everyone and discoverable on GitHub</option>
    </select>
  </label>
  {#if gistVisibility === "public"}<p class="warning">A public backup shares your tracked apps and startup preferences with everyone.</p>{/if}
{/snippet}

<main class="settings-page">
  <section class="content">
      <div class="page-heading">
      <a class="back-button" href="/" aria-label="Back to apps" title="Back to apps">
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="M640-80 240-480l400-400 71 71-329 329 329 329-71 71Z"/></svg>
      </a>
      <div>
        <h1>Settings</h1>
        <p>App behavior, backups, and migration</p>
        </div>
      </div>

      {#if error}
        <div class="error-notice" role="alert">{error}</div>
      {/if}
      {#if notice}<div class="notice" role="status">{notice}</div>{/if}

      <section class="settings-group" class:review-dimmed={!!pendingBackup} inert={!!pendingBackup} aria-labelledby="startup-heading">
        <h2 id="startup-heading">App behavior</h2>
        <label class="setting-row">
          <span class="setting-copy">
            <strong>Keep running in the background</strong>
            <span>Keep Updainium available in the system tray when its window is closed.</span>
          </span>
          <span class="material-switch">
            <input
              type="checkbox"
              checked={backgroundEnabled}
              disabled={!ready || busy}
              onchange={(event) => run(() => setBackgroundEnabled(event.currentTarget.checked))}
            />
            <span class="switch-track"></span>
          </span>
        </label>
        <label class="setting-row">
          <span class="setting-copy">
            <strong>Start when the system starts</strong>
            <span>Launch Updainium automatically when you sign in.</span>
          </span>
          <span class="material-switch">
            <input
              type="checkbox"
              checked={startOnLogin}
              disabled={!ready || busy}
              onchange={(event) => run(() => setStartOnLogin(event.currentTarget.checked))}
            />
            <span class="switch-track"></span>
          </span>
        </label>
      </section>
      <section class="settings-group backup-group" class:review-dimmed={!!pendingBackup} inert={!!pendingBackup} aria-labelledby="backup-heading">
        <h2 id="backup-heading">Import and export</h2>
        <div class="group-body">
          <p>Move your tracked apps and startup preferences between computers using a JSON backup. Downloaded files, release caches, and GitHub credentials are excluded.</p>
          <div class="actions">
            <button disabled={!ready || busy} onclick={() => run(exportJson)}>Export JSON</button>
            <button disabled={!ready || busy} onclick={() => run(importJson)}>Import JSON</button>
          </div>
          <label class="field">Import from a shared gist
            <input bind:value={sharedGist} disabled={busy} placeholder="https://gist.github.com/username/gist-id or a gist ID" />
          </label>
          <p>Import apps someone shared with you. Sign-in is not required for public or secret gists.</p>
          <div class="actions"><button class="secondary" disabled={!ready || busy || !sharedGist.trim()} onclick={() => runGithub(importSharedGist)}>Preview gist import</button></div>
        </div>
      </section>

      {#if pendingBackup}
        <section class="settings-group backup-group review-panel" aria-labelledby="preview-heading">
          <h2 id="preview-heading">Review backup</h2>
          <div class="group-body">
            <p>{pendingBackup.sources.length} apps · Exported {pendingBackup.exportedAt}</p>
            {#if pendingBackup.sources.length}
              <ul>{#each pendingBackup.sources.slice(0, 8) as source}<li>{source.repo}</li>{/each}</ul>
              {#if pendingBackup.sources.length > 8}<p>And {pendingBackup.sources.length - 8} more apps.</p>{/if}
            {/if}
            <label class="field">Import behavior
              <select bind:value={importMode} disabled={busy}>
                <option value="merge">Add to current apps — keep existing apps and add missing apps</option>
                <option value="replace">Clean and import — replace the entire app catalog</option>
              </select>
            </label>
            {#if importMode === "replace"}<p class="warning">This replaces all currently tracked apps with the apps in this backup.</p>{/if}
            <label class="check-field"><input type="checkbox" bind:checked={applyPreferences} disabled={busy} />Apply startup and background preferences</label>
            <p>Backup preferences: background {pendingBackup.settings.backgroundEnabled ? "on" : "off"}, start on login {pendingBackup.settings.startOnLogin ? "on" : "off"}.</p>
            <p>App identifiers and file preferences are preserved. You may need to adjust them when moving to a different operating system.</p>
            <div class="actions">
              <button disabled={busy} onclick={() => run(applyImport)}>Confirm import</button>
              <button class="secondary" disabled={busy} onclick={() => pendingBackup = null}>Cancel</button>
            </div>
          </div>
        </section>
      {/if}

      <section class="settings-group backup-group" class:review-dimmed={!!pendingBackup} inert={!!pendingBackup} aria-labelledby="github-heading">
        <h2 id="github-heading">GitHub Gist backups</h2>
        <div class="group-body">
          <p>Save and restore the same JSON backup through your GitHub account, or share your app catalog with a gist link.</p>
          {#if githubError}<div class="error-notice" role="alert">{githubError}</div>{/if}
          {#if githubNotice}<div class="notice" role="status">{githubNotice}</div>{/if}
          {#if githubBusy}<p role="status" aria-live="polite">{connectionStatus || "Working with GitHub…"}</p>{/if}
          {#if login}
            <div class="account-row"><strong>Connected as {login}</strong><button class="secondary" disabled={busy} onclick={() => runGithub(disconnect)}>Disconnect</button></div>
            <p>Your sign-in is saved in this computer’s system credential store. Tokens are never included in JSON or gist backups.</p>
            {#if !backupsLoaded}
              <p>Load your existing backups before creating or updating one.</p>
              <div class="actions"><button disabled={busy} onclick={() => runGithub(loadGists)}>Load backups</button></div>
            {:else if !gists.length}
              <p>Create your main backup once, then update the same gist. Older versions stay in its revision history.</p>
              {@render backupVisibility()}
              <div class="actions">
                <button disabled={!ready || busy} onclick={() => runGithub(() => uploadGist(null))}>Create backup</button>
                <button class="secondary" disabled={busy} onclick={() => runGithub(loadGists)}>Refresh</button>
              </div>
            {:else}
              {#if gists.length > 1}
                <label class="field">Main backup
                  <select value={selectedGist} disabled={busy} onchange={(event) => selectMainBackup(event.currentTarget.value)}>
                    <option value="">Choose your main backup</option>
                    {#each gists as gist}<option value={gist.id}>{gist.description || "Updainium backup"} · {new Date(gist.updated_at).toLocaleString()} · {gist.id.slice(0, 8)} · {gist.public ? "public" : "secret"}</option>{/each}
                  </select>
                </label>
                <p>Your choice is remembered for this GitHub account on this computer. Other gists are kept.</p>
              {/if}
              {#if mainBackup}
                <p><strong>Main backup · {mainBackup.public ? "Public" : "Secret"}</strong><br />Last updated {new Date(mainBackup.updated_at).toLocaleString()}</p>
                <p>Updates reuse this gist and preserve its previous versions.</p>
              {:else}
                <p>Select the gist you want to keep updating.</p>
              {/if}
              <div class="actions">
                <button disabled={!ready || busy || !mainBackup} onclick={() => runGithub(prepareUpdate)}>Update backup</button>
                <button class="secondary" disabled={!ready || busy || !mainBackup} onclick={() => runGithub(prepareRestore)}>Restore backup</button>
                <button class="secondary" disabled={busy || !mainBackup} onclick={() => runGithub(() => openGist(selectedGist))}>Open gist</button>
                <button class="secondary" disabled={busy} onclick={() => runGithub(loadGists)}>Refresh</button>
              </div>
              {#if confirmUpload && mainBackup}
                <div class="upload-confirm">
                  <p>The latest backup was updated {new Date(mainBackup.updated_at).toLocaleString()}. Check this date if another computer also uses this backup.</p>
                  <p>Upload your current apps and preferences as a new revision? Existing revisions and visibility will be preserved.</p>
                  <div class="actions">
                    <button disabled={busy} onclick={() => runGithub(() => uploadGist(selectedGist))}>Confirm update</button>
                    <button class="secondary" disabled={busy} onclick={() => confirmUpload = false}>Cancel</button>
                  </div>
                </div>
              {/if}
              {#if showRestore}
                <div class="upload-confirm">
                  <label class="field">Version to restore
                    <select bind:value={selectedRevision} disabled={busy}>
                      <option value="">Latest version</option>
                      {#each revisions.slice(1) as revision}<option value={revision.version}>{new Date(revision.committed_at).toLocaleString()} · {revision.version.slice(0, 8)}</option>{/each}
                    </select>
                  </label>
                  <p>Choose the latest backup or an older revision. You can review the apps and choose add or replace before importing.</p>
                  <div class="actions">
                    <button disabled={busy} onclick={() => runGithub(downloadGist)}>Preview restore</button>
                    <button class="secondary" disabled={busy} onclick={() => showRestore = false}>Cancel</button>
                  </div>
                </div>
              {/if}
              <details class="additional-backup">
                <summary>Create a separate backup</summary>
                <p>Use another gist for a separate app collection. It becomes your main backup; existing gists are kept.</p>
                {@render backupVisibility()}
                <div class="actions"><button class="secondary" disabled={!ready || busy} onclick={() => runGithub(() => uploadGist(null))}>Create separate backup</button></div>
              </details>
            {/if}
          {:else}
            <p>Create a GitHub personal access token with the <strong>gist</strong> scope, then paste it here. A fine-grained token with Gists read and write permission also works.</p>
            <div class="actions">
              <button type="button" class="secondary" disabled={busy} onclick={() => runGithub(() => openUrl("https://github.com/settings/tokens/new?scopes=gist&description=Updainium"))}>Create GitHub token</button>
            </div>
            <form onsubmit={(event) => { event.preventDefault(); if (accessToken.trim()) void runGithub(connectToken); }}>
              <label class="field">GitHub token<input type="password" bind:value={accessToken} disabled={busy} autocomplete="off" spellcheck="false" /></label>
              <div class="actions"><button type="submit" disabled={busy || !accessToken.trim()}>{githubBusy ? "Connecting…" : "Connect token"}</button></div>
            </form>
          {/if}
        </div>
      </section>
      {#if busy}<p role="status" class="busy-status">Working…</p>{/if}
  </section>
</main>

<dialog bind:this={githubDialog} class="github-progress" aria-labelledby="github-progress-title" oncancel={(event) => { event.preventDefault(); void cancelGithub(); }}>
  <h2 id="github-progress-title">Connecting to GitHub</h2>
  <div class="group-body">
    <div class="progress-track" aria-hidden="true"><span></span></div>
    <p role="status" aria-live="polite">{connectionStatus || "Waiting for GitHub…"}</p>
    <div class="actions"><button class="secondary" disabled={cancellingGithub} onclick={cancelGithub}>{cancellingGithub ? "Cancelling…" : "Cancel"}</button></div>
  </div>
</dialog>

<style>
  :global(*) { box-sizing: border-box; }
  :global(:root) { --page: #fff8ff; --surface: #f7f0f8; --surface-raised: #fffaff; --surface-muted: #eee7f0; --text: #24212a; --muted: #56515d; --subtle: #817b87; --border: #e9e0ec; --accent: #705394; }
  :global(body) { margin: 0; color: var(--text); background: var(--page); font-family: "Roboto", "Segoe UI", sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased; }
  .settings-page { min-height: 100vh; }
  .github-progress { width: min(440px, calc(100vw - 40px)); padding: 0; border: 1px solid var(--border); border-radius: 24px; color: var(--text); background: var(--surface-raised); box-shadow: 0 16px 64px #0004; }
  .github-progress::backdrop { background: #0006; }
  .progress-track { height: 4px; overflow: hidden; border-radius: 4px; background: var(--surface-muted); margin-top: 12px; }
  .progress-track span { display: block; width: 40%; height: 100%; background: var(--accent); animation: github-progress 1.2s ease-in-out infinite alternate; }
  @keyframes github-progress { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
  @media (prefers-reduced-motion: reduce) { .progress-track span { animation: none; width: 100%; } }
  .backup-group { margin-top: 24px; }
  .group-body { padding: 0 26px 24px; }
  .group-body p { color: var(--muted); line-height: 1.55; }
  .group-body ul { padding-left: 22px; line-height: 1.7; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  button { border: 1px solid transparent; border-radius: 22px; padding: 11px 18px; background: var(--accent); color: var(--page); font: inherit; font-weight: 500; cursor: pointer; }
  button.secondary { color: var(--text); border-color: var(--border); background: var(--surface-raised); }
  button:disabled { opacity: .5; cursor: default; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .field { display: grid; gap: 8px; margin: 16px 0; font-weight: 500; }
  .field input, .field select { width: 100%; min-width: 0; padding: 12px; border: 1px solid var(--border); border-radius: 12px; color: var(--text); background: var(--surface-raised); font: inherit; }
  .check-field { display: flex; align-items: center; gap: 10px; margin: 20px 0 0; }
  .check-field input { accent-color: var(--accent); }
  .account-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
  .additional-backup { margin-top: 24px; }
  .additional-backup summary { cursor: pointer; color: var(--muted); }
  .upload-confirm { margin-top: 18px; padding: 4px 16px 16px; border: 1px solid var(--border); border-radius: 16px; overflow-wrap: anywhere; }
  .group-body .warning { color: #b45309; }
  .notice { margin: 0 0 16px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); line-height: 1.5; }
  .busy-status { color: var(--muted); }
  .content { width: min(880px, 100%); margin: 0 auto; padding: 72px 52px 60px; }
  .page-heading { display: flex; align-items: center; gap: 15px; margin-bottom: 34px; }
  .back-button { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 50%; color: var(--text); text-decoration: none; transition: background .16s ease, transform .16s ease; }
  .back-button:hover { background: var(--surface-muted); }
  .back-button:active { transform: translateX(-2px); }
  .back-button svg { width: 23px; height: 23px; fill: currentColor; stroke: none; }
  h1 { margin: 0; color: var(--text); font-size: 36px; font-weight: 500; letter-spacing: -.8px; }
  .page-heading p { margin: 9px 0 0; color: var(--muted); font-size: 14px; }
  .settings-group { max-width: 760px; overflow: hidden; border: 1px solid transparent; border-radius: 24px; background: var(--surface); }
  .settings-group { transition: opacity .2s ease; }
  .settings-group.review-dimmed { opacity: .3; }
  .review-panel { border-color: var(--accent); box-shadow: 0 4px 24px color-mix(in srgb, var(--accent) 12%, transparent); scroll-margin-top: 24px; }
  @media (prefers-reduced-motion: reduce) {
    .settings-group { transition: none; }
  }
  h2 { margin: 0; padding: 22px 26px 12px; color: var(--text); font-size: 20px; font-weight: 500; }
  .setting-row { display: flex; min-height: 86px; align-items: center; justify-content: space-between; gap: 24px; padding: 17px 26px; cursor: pointer; }
  .setting-row + .setting-row { border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
  .setting-copy { display: grid; gap: 6px; }
  .setting-copy strong { color: var(--text); font-size: 15px; font-weight: 500; }
  .setting-copy span { color: var(--muted); font-size: 13px; line-height: 1.45; }
  .material-switch { position: relative; display: grid; width: 52px; height: 32px; flex: 0 0 auto; place-items: center; }
  .material-switch input { position: absolute; z-index: 1; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .switch-track { display: flex; width: 52px; height: 32px; align-items: center; padding: 0 4px; border: 2px solid var(--muted); border-radius: 16px; background: transparent; transition: background .16s ease, border-color .16s ease; }
  .switch-track::before { width: 16px; height: 16px; border-radius: 50%; background: var(--muted); content: ""; transition: width .16s ease, height .16s ease, transform .16s ease, background .16s ease; }
  .material-switch input:checked + .switch-track { border-color: var(--accent); background: var(--accent); }
  .material-switch input:checked + .switch-track::before { width: 24px; height: 24px; transform: translateX(18px); background: var(--surface-raised); }
  .material-switch input:focus-visible + .switch-track { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 3px; }
  .material-switch input:disabled { cursor: wait; }
  .material-switch input:disabled + .switch-track { opacity: .55; }
  .error-notice { max-width: 760px; margin: 0 0 16px; padding: 12px 16px; border: 1px solid #f2d5d5; border-radius: 12px; background: #fff5f4; color: #a03e3a; line-height: 1.5; }
  @media (max-width: 760px) {
    .content { padding: 48px 20px 40px; }
    .page-heading { margin-bottom: 24px; }
    .back-button { width: 34px; height: 34px; }
    h1 { font-size: 30px; }
    .settings-group { border-radius: 22px; }
    h2 { padding: 19px 20px 10px; }
    .setting-row { min-height: 78px; gap: 14px; padding: 15px 20px; }
  }
  @media (max-width: 420px) {
    .content { padding: 32px 16px; }
    .setting-row { align-items: flex-start; }
    .setting-copy span { max-width: 250px; }
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) { --page: #151217; --surface: #201d23; --surface-raised: #252128; --surface-muted: #302b34; --text: #f0eaf3; --muted: #c4bbc9; --subtle: #a29aa8; --border: #39333d; --accent: #d2b7ff; }
  }
</style>
