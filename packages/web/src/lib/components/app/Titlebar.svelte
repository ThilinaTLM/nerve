<script lang="ts">
  import Activity from "lucide-svelte/icons/activity";
  import AppWindow from "lucide-svelte/icons/app-window";
  import Monitor from "lucide-svelte/icons/monitor";
  import Moon from "lucide-svelte/icons/moon";
  import PanelRight from "lucide-svelte/icons/panel-right";
  import Radio from "lucide-svelte/icons/radio";
  import Sun from "lucide-svelte/icons/sun";
  import TriangleAlert from "lucide-svelte/icons/triangle-alert";
  import Wrench from "lucide-svelte/icons/wrench";
  import type { ProjectRecord, SessionRecord } from "../../api";
  import type { ThemePreference } from "../../state/app-state.svelte";
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import DropdownMenu, { type MenuItem } from "../ui/DropdownMenu.svelte";

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

  const themeItems = $derived<MenuItem[]>([
    { value: "system", label: "System", detail: "Follow OS appearance", checked: themePreference === "system" },
    { value: "light", label: "Light", detail: "Bright desktop theme", checked: themePreference === "light" },
    { value: "dark", label: "Dark", detail: "Dim command-center theme", checked: themePreference === "dark" },
  ]);

  const contextLabel = $derived(activeProject?.name ?? "No project");
  const sessionLabel = $derived(activeSession?.title ?? "No active session");

  function themeIcon() {
    if (themePreference === "light") return Sun;
    if (themePreference === "dark") return Moon;
    return Monitor;
  }
</script>

<header class="titlebar">
  <div class="title-left">
    <span class="app-mark" aria-hidden="true"><AppWindow size={14} strokeWidth={2.2} /></span>
    <span class="app-name">nerve</span>
    <span class="divider" aria-hidden="true"></span>
    <span class="context" title={`${activeProject?.dir ?? "No project"}${activeSession ? ` / ${activeSession.id}` : ""}`}>
      <span>{contextLabel}</span>
      <b>/</b>
      <span>{sessionLabel}</span>
    </span>
  </div>

  <div class="title-actions">
    {#if pendingApprovals > 0}
      <Badge tone="warn"><TriangleAlert size={12} strokeWidth={2.25} />{pendingApprovals} approval{pendingApprovals === 1 ? "" : "s"}</Badge>
    {/if}

    <Badge tone={live ? "good" : connection === "error" ? "danger" : "neutral"}>
      {#if live}<Radio size={12} strokeWidth={2.25} />{:else}<Activity size={12} strokeWidth={2.25} />{/if}
      {connection}
    </Badge>

    <DropdownMenu
      items={themeItems}
      label="Theme"
      ariaLabel="Theme preference"
      triggerClass="theme-menu"
      onSelect={(value) => onThemeChange?.(value as ThemePreference)}
    >
      {@const ThemeIcon = themeIcon()}
      <ThemeIcon size={13} strokeWidth={2.15} aria-hidden="true" />
      <span>{themePreference}</span>
    </DropdownMenu>

    <Button
      variant="icon"
      size="icon"
      ariaLabel={utilityOpen ? "Hide utility panel" : "Show utility panel"}
      title={utilityOpen ? "Hide utility panel" : "Show utility panel"}
      active={utilityOpen}
      onclick={onToggleUtility}
    >
      {#if utilityOpen}<PanelRight size={14} strokeWidth={2.25} />{:else}<Wrench size={14} strokeWidth={2.25} />{/if}
    </Button>
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 2.15rem;
    border-bottom: 1px solid var(--color-border-subtle);
    background: var(--color-titlebar);
    box-shadow: var(--shadow-panel);
    padding: 0 0.5rem;
    user-select: none;
  }

  .title-left,
  .title-actions {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.45rem;
  }

  .title-actions {
    flex: none;
  }

  .app-mark {
    display: inline-grid;
    width: 1.35rem;
    height: 1.35rem;
    place-items: center;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-accent);
  }

  .app-name {
    color: var(--color-text);
    font-size: 0.8rem;
    font-weight: 750;
    letter-spacing: 0.01em;
  }

  .divider {
    width: 1px;
    height: 1rem;
    background: var(--color-border-subtle);
  }

  .context {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 0.35rem;
    overflow: hidden;
    color: var(--color-muted);
    font-size: 0.74rem;
  }

  .context span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context span:first-child {
    color: var(--color-text);
  }

  .context b {
    color: var(--color-faint);
    font-weight: 500;
  }

  :global(.theme-menu) {
    min-width: 5.5rem;
    text-transform: capitalize;
  }

  @media (max-width: 760px) {
    .context b,
    .context span:last-child {
      display: none;
    }
  }
</style>
