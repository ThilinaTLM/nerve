<script lang="ts">
  import type { ProjectRecord, SessionRecord } from "../../api";
  import type { ThemePreference } from "../../state/app-state.svelte";

  type Props = {
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    connection?: string;
    live?: boolean;
    pendingApprovals?: number;
    utilityOpen?: boolean;
    themePreference?: ThemePreference;
    onToggleUtility?: () => void;
    onThemeChange?: (theme: ThemePreference) => void;
  };

  let {
    activeProject,
    activeSession,
    connection = "connecting",
    live = false,
    pendingApprovals = 0,
    utilityOpen = false,
    themePreference = "system",
    onToggleUtility,
    onThemeChange,
  }: Props = $props();
</script>

<header class="titlebar">
  <div class="title-left">
    <span class="app-name">nerve</span>
    <span class="context">{activeProject?.name ?? "no project"}{activeSession ? ` / ${activeSession.title}` : ""}</span>
  </div>
  <div class="title-actions">
    {#if pendingApprovals > 0}<span class="approval-badge">{pendingApprovals} approvals</span>{/if}
    <span class:live class="connection">{connection}</span>
    <div class="theme-toggle" aria-label="Theme preference">
      {#each ["system", "light", "dark"] as theme}
        <button
          type="button"
          class:active={themePreference === theme}
          onclick={() => onThemeChange?.(theme as ThemePreference)}
        >{theme.slice(0, 1)}</button>
      {/each}
    </div>
    <button class="utility-button" class:active={utilityOpen} type="button" onclick={onToggleUtility}>tools</button>
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 2rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-panel-muted);
    padding: 0 0.5rem;
    user-select: none;
  }

  .title-left,
  .title-actions,
  .theme-toggle {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.45rem;
  }

  .app-name {
    color: var(--color-text);
    font-size: 0.78rem;
    font-weight: 650;
  }

  .context {
    overflow: hidden;
    color: var(--color-muted);
    font-size: 0.74rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection,
  .approval-badge,
  .utility-button,
  .theme-toggle button {
    height: 1.35rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-muted);
    padding: 0 0.4rem;
    font-size: 0.68rem;
  }

  .connection.live {
    color: var(--color-accent);
  }

  .approval-badge {
    color: var(--color-warn);
  }

  .utility-button,
  .theme-toggle button {
    cursor: pointer;
  }

  .utility-button.active,
  .theme-toggle button.active,
  .utility-button:hover,
  .theme-toggle button:hover {
    background: var(--color-panel-raised);
    color: var(--color-text);
  }
</style>
