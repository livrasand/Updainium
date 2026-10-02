<script lang="ts">
  import { onMount } from "svelte";
  import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { invoke } from "@tauri-apps/api/core";

  const backgroundKey = "updainium.background.v1";
  let backgroundEnabled = $state(false);
  let startOnLogin = $state(false);
  let ready = $state(false);
  let error = $state("");

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

<main class="settings-page">
  <section class="content">
      <div class="page-heading">
      <a class="back-button" href="/" aria-label="Back to apps" title="Back to apps">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h11"></path></svg>
      </a>
      <div>
        <h1>Settings</h1>
        <p>Startup and background behavior</p>
        </div>
      </div>

      {#if error}
        <div class="error-notice" role="alert">{error}</div>
      {/if}

      <section class="settings-group" aria-labelledby="startup-heading">
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
              disabled={!ready}
              onchange={(event) => setBackgroundEnabled(event.currentTarget.checked)}
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
              disabled={!ready}
              onchange={(event) => setStartOnLogin(event.currentTarget.checked)}
            />
            <span class="switch-track"></span>
          </span>
        </label>
      </section>
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(:root) { --page: #fff8ff; --surface: #f7f0f8; --surface-raised: #fffaff; --surface-muted: #eee7f0; --text: #24212a; --muted: #56515d; --subtle: #817b87; --border: #e9e0ec; --accent: #705394; }
  :global(body) { margin: 0; color: var(--text); background: var(--page); font-family: "Roboto", "Segoe UI", sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased; }
  .settings-page { min-height: 100vh; }
  .content { width: min(880px, 100%); margin: 0 auto; padding: 72px 52px 60px; }
  .page-heading { display: flex; align-items: center; gap: 15px; margin-bottom: 34px; }
  .back-button { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 50%; color: var(--text); text-decoration: none; transition: background .16s ease, transform .16s ease; }
  .back-button:hover { background: var(--surface-muted); }
  .back-button:active { transform: translateX(-2px); }
  .back-button svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  h1 { margin: 0; color: var(--text); font-size: 36px; font-weight: 500; letter-spacing: -.8px; }
  .page-heading p { margin: 9px 0 0; color: var(--muted); font-size: 14px; }
  .settings-group { max-width: 760px; overflow: hidden; border: 1px solid transparent; border-radius: 24px; background: var(--surface); }
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
