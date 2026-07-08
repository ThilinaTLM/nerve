<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import X from "@lucide/svelte/icons/x";
  import { Button } from "@nervekit/shared-ui/components/ui/button";
  import ContextMenu, {
    type ContextMenuItem,
  } from "@nervekit/shared-ui/components/ui/context-menu-list";
  import { StatusDot } from "@nervekit/shared-ui/components/ui/status-dot";
  import type {
    WorkbenchTabIdentity,
    WorkbenchTabMenuBuilder,
    WorkbenchTabModel,
  } from "./types";

  let {
    tabs = [],
    refreshShortcut,
    closeShortcut,
    closeOthersShortcut,
    newLabel = "New chat",
    newShortcut,
    newShortcutAria,
    buildMenuItems,
    onSelect,
    onClose,
    onRefresh,
    onCloseOther,
    onCloseRight,
    onCloseLeft,
    onNew,
  }: {
    tabs?: WorkbenchTabModel[];
    refreshShortcut?: string;
    closeShortcut?: string;
    closeOthersShortcut?: string;
    newLabel?: string;
    newShortcut?: string;
    newShortcutAria?: string;
    buildMenuItems?: WorkbenchTabMenuBuilder;
    onSelect?: (tab: WorkbenchTabIdentity) => void;
    onClose?: (tab: WorkbenchTabIdentity) => void;
    onRefresh?: (tab: WorkbenchTabIdentity) => void;
    onCloseOther?: (tab: WorkbenchTabIdentity) => void;
    onCloseRight?: (tab: WorkbenchTabIdentity) => void;
    onCloseLeft?: (tab: WorkbenchTabIdentity) => void;
    onNew?: () => void;
  } = $props();

  function identity(tab: WorkbenchTabModel): WorkbenchTabIdentity {
    return { kind: tab.kind, id: tab.id };
  }

  function tabKey(tab: WorkbenchTabModel): string {
    return tab.key ?? `${tab.kind}:${tab.id}`;
  }

  function defaultMenu(tab: WorkbenchTabModel, index: number): ContextMenuItem[] {
    const id = identity(tab);
    const hasLeft = index > 0;
    const hasRight = index >= 0 && index < tabs.length - 1;
    return [
      {
        label: "Refresh",
        icon: RefreshCw,
        shortcut: refreshShortcut,
        disabled: !onRefresh,
        onSelect: () => onRefresh?.(id),
      },
      { type: "separator" },
      {
        label: "Close Pane",
        icon: X,
        shortcut: closeShortcut,
        disabled: tab.closeable === false || !onClose,
        onSelect: () => onClose?.(id),
      },
      {
        label: "Close Other Panes",
        icon: X,
        shortcut: closeOthersShortcut,
        disabled: tabs.length <= 1 || !onCloseOther,
        onSelect: () => onCloseOther?.(id),
      },
      {
        label: "Close Panes on Right",
        icon: X,
        disabled: !hasRight || !onCloseRight,
        onSelect: () => onCloseRight?.(id),
      },
      {
        label: "Close Panes on Left",
        icon: X,
        disabled: !hasLeft || !onCloseLeft,
        onSelect: () => onCloseLeft?.(id),
      },
    ];
  }

  function menuItems(tab: WorkbenchTabModel, index: number): ContextMenuItem[] {
    return buildMenuItems?.({ tab, tabs, index }) ?? defaultMenu(tab, index);
  }
</script>

<nav class="center-tab-strip" aria-label="Open center tabs">
  <div class="tab-scroller" role="tablist" aria-label="Open center panes">
    {#each tabs as tab, index (tabKey(tab))}
      {@const Icon = tab.icon}
      {@const SelectIcon = tab.selectIcon}
      {@const ToggleIcon = tab.toggle?.icon}
      <ContextMenu
        items={menuItems(tab, index)}
        triggerClass={`center-tab-menu-trigger ${tab.wide ? "wide-tab" : ""}`}
      >
        <div
          class="center-tab"
          class:active={tab.active}
          class:running={tab.running}
          class:errored={Boolean(tab.error)}
        >
          <div class="tab-leading">
            {#if tab.toggle && ToggleIcon}
              <button
                type="button"
                class="tab-file-toggle"
                aria-label={tab.toggle.label}
                title={tab.toggle.title ?? tab.toggle.label}
                disabled={tab.toggle.disabled}
                onclick={(event) => {
                  event.stopPropagation();
                  tab.toggle?.onClick?.(event);
                }}
              >
                <ToggleIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              </button>
            {:else if tab.status?.tone}
              <StatusDot
                class="tab-agent-status"
                tone={tab.status.tone}
                pulse={tab.status.pulse}
                label={tab.status.label}
              />
            {:else if tab.status || tab.running || tab.error}
              <span class="tab-status" title={tab.status?.label} aria-hidden="true"></span>
            {:else if Icon}
              <span class="tab-kind-icon">
                <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
            {/if}
          </div>
          <button
            type="button"
            class="tab-select"
            role="tab"
            aria-selected={tab.active}
            title={tab.title ?? tab.label}
            onclick={() => onSelect?.(identity(tab))}
          >
            {#if SelectIcon}
              <span class="tab-kind-icon">
                <SelectIcon size={12} strokeWidth={2.2} aria-hidden="true" />
              </span>
            {/if}
            <span class="tab-title">{tab.label}</span>
            {#if tab.draft}
              <span class="draft-dot" title="Draft" aria-label="Draft"></span>
            {/if}
          </button>
          <button
            type="button"
            class="tab-close"
            aria-label={`Close ${tab.label}`}
            title="Close tab"
            disabled={tab.closeable === false}
            onclick={() => onClose?.(identity(tab))}
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      </ContextMenu>
    {/each}
  </div>

  {#if onNew}
    <div class="tab-actions">
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel={newLabel}
        aria-keyshortcuts={newShortcutAria}
        title={newShortcut ? `${newLabel} (${newShortcut})` : newLabel}
        onclick={onNew}
      >
        <Plus size={13} strokeWidth={2.25} />
      </Button>
    </div>
  {/if}
</nav>
