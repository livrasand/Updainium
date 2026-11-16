<script lang="ts">
  import { onMount } from "svelte";
  import { executeCommand, findCommands, type Command } from "./commands";

  let open = $state(false);
  let query = $state("");
  let selected = $state(0);
  let error = $state("");
  let input = $state<HTMLInputElement>();

  const commands = $derived(findCommands(query));

  function openPalette(): void {
    query = "";
    selected = 0;
    error = "";
    open = true;
  }

  function closePalette(): void {
    open = false;
  }

  function togglePalette(): void {
    if (open) closePalette();
    else openPalette();
  }

  async function runCommand(command: Command): Promise<void> {
    if (!command) return;
    closePalette();
    error = "";
    try {
      await executeCommand(command.id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      open = true;
    }
  }

  function onInput(): void {
    selected = 0;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (commands.length) selected = (selected + 1) % commands.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (commands.length) selected = (selected - 1 + commands.length) % commands.length;
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = commands[selected];
      if (command) void runCommand(command);
    }
  }

  $effect(() => {
    if (open) input?.focus();
  });

  onMount(() => {
    function onWindowKeydown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        togglePalette();
      }
    }
    window.addEventListener("keydown", onWindowKeydown);
    return () => window.removeEventListener("keydown", onWindowKeydown);
  });
</script>

{#if open}
  <div
    class="palette-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) closePalette();
    }}
  >
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="palette-input-row">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="m20 20-4-4"></path>
        </svg>
        <input
          bind:this={input}
          bind:value={query}
          oninput={onInput}
          onkeydown={onKeydown}
          placeholder="Type a command…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-autocomplete="list"
          aria-activedescendant={commands[selected] ? `command-${selected}` : undefined}
          autocomplete="off"
          spellcheck="false"
        />
        <kbd>Esc</kbd>
      </div>
      {#if error}
        <div class="palette-error" role="alert">{error}</div>
      {/if}
      <div class="palette-list" id="command-list" role="listbox" aria-label="Commands">
        {#each commands as command, index (command.id)}
          <button
            class="palette-item"
            class:selected={index === selected}
            id={`command-${index}`}
            type="button"
            role="option"
            aria-selected={index === selected}
            tabindex="-1"
            onclick={() => runCommand(command)}
            onmousemove={() => (selected = index)}
          >
            <span class="palette-item-title">{command.title}</span>
            {#if command.category}
              <span class="palette-item-category">{command.category}</span>
            {/if}
          </button>
        {:else}
          <div class="palette-empty">No commands match “{query}”.</div>
        {/each}
      </div>
      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> run</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .palette-backdrop {
    position: fixed;
    z-index: 50;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh 16px 16px;
    background: rgb(20 16 24 / 35%);
    backdrop-filter: blur(3px);
  }

  .palette {
    width: min(620px, 100%);
    overflow: hidden;
    border: 1px solid var(--border, #e9e0ec);
    border-radius: 18px;
    background: var(--surface-raised, #fffaff);
    color: var(--text, #24212a);
    box-shadow: 0 24px 80px rgb(20 16 24 / 28%);
  }

  .palette-input-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border, #e9e0ec);
  }

  .palette-input-row svg {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    color: var(--muted, #56515d);
  }

  .palette-input-row input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text, #24212a);
    font: inherit;
    font-size: 16px;
  }

  .palette-input-row input::placeholder {
    color: var(--muted, #56515d);
  }

  .palette kbd {
    padding: 2px 6px;
    border: 1px solid var(--border, #e9e0ec);
    border-radius: 6px;
    background: var(--surface-muted, #eee7f0);
    color: var(--muted, #56515d);
    font-family: inherit;
    font-size: 11px;
    line-height: 1.4;
  }

  .palette-list {
    max-height: 360px;
    overflow-y: auto;
    padding: 6px;
  }

  .palette-item {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text, #24212a);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .palette-item.selected {
    background: var(--surface-muted, #eee7f0);
  }

  .palette-item-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .palette-item-category {
    flex: 0 0 auto;
    color: var(--muted, #56515d);
    font-size: 12px;
  }

  .palette-empty {
    padding: 18px 12px;
    color: var(--muted, #56515d);
    text-align: center;
  }

  .palette-error {
    padding: 8px 16px;
    color: #a03e3a;
    background: #fff5f4;
    font-size: 13px;
  }

  .palette-footer {
    display: flex;
    gap: 16px;
    padding: 9px 16px;
    border-top: 1px solid var(--border, #e9e0ec);
    color: var(--muted, #56515d);
    font-size: 11px;
  }

  .palette-footer span {
    display: flex;
    gap: 5px;
    align-items: center;
  }
</style>