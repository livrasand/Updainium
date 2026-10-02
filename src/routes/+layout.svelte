<script lang="ts">
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let { children }: { children: Snippet } = $props();
  const backgroundKey = "updainium.background.v1";
  let backgroundError = $state("");

  onMount(() => {
    const window = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void window
      .onCloseRequested((event) => {
        if (localStorage.getItem(backgroundKey) === "true") {
          event.preventDefault();
          void window.hide();
        }
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      });

    void invoke("set_background_mode", {
      enabled: localStorage.getItem(backgroundKey) === "true",
    }).catch((error: unknown) => {
      backgroundError = error instanceof Error ? error.message : String(error);
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  });
</script>

{#if backgroundError}
  <div class="runtime-error" role="alert">Could not apply background settings: {backgroundError}</div>
{/if}
{@render children()}

<style>
  .runtime-error {
    position: fixed;
    z-index: 10;
    top: 12px;
    right: 12px;
    max-width: 420px;
    padding: 12px 16px;
    border: 1px solid #f2d5d5;
    border-radius: 8px;
    background: #fff5f4;
    color: #a03e3a;
    font: 13px/1.5 sans-serif;
  }
</style>
