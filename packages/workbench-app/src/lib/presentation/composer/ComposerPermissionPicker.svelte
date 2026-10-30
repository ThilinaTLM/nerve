<script lang="ts">
import Popover from "@nervekit/ui-kit/components/composites/popover-panel";
import type {
  PermissionRuleSetId,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import { permissionIcon } from "./composer-icons";
import ComposerPermissionPanel from "./ComposerPermissionPanel.svelte";

let {
  activePermission,
  permissionRuleSets,
  loading = false,
  error,
  lockedBy,
  controlsDisabled = false,
  shortcut,
  shortcutAria,
  onChange,
  onRefresh,
  onOpenSettings,
}: {
  activePermission: PermissionRuleSetSummary;
  permissionRuleSets: PermissionRuleSetSummary[];
  loading?: boolean;
  error?: string;
  lockedBy?: string;
  controlsDisabled?: boolean;
  shortcut?: string;
  shortcutAria?: string;
  onChange?: (id: PermissionRuleSetId) => void;
  onRefresh?: () => void;
  onOpenSettings?: () => void;
} = $props();

let open = $state(false);
const ActiveIcon = $derived(permissionIcon(activePermission.id));
const showLabel = $derived(activePermission.id !== "default");

function select(id: PermissionRuleSetId) {
  if (id !== activePermission.id) onChange?.(id);
  open = false;
}
</script>

<Popover
  triggerWidthKey={`${activePermission.id}:${showLabel ? activePermission.name : ""}`}
  bind:open
  size="lg"
  triggerClass={`composer-tab ${showLabel ? "" : "w-control p-0"} @max-[480px]/composer-toolbar:w-control @max-[480px]/composer-toolbar:p-0 @max-[480px]/composer-toolbar:text-warning @max-[480px]/composer-toolbar:animate-in @max-[480px]/composer-toolbar:fade-in-0 @max-[480px]/composer-toolbar:zoom-in-50`}
  ariaLabel="Permission rule set"
  triggerTitle={`Permission rule set: ${activePermission.name}${shortcut ? ` (${shortcut})` : ""}${lockedBy ? ` · Locked by ${lockedBy}` : ""}`}
  triggerAriaKeyShortcuts={shortcutAria}
  side="top"
  align="start"
  presentation="adaptive"
>
  {#snippet trigger()}
    <span
      class={`inline-flex items-center justify-center gap-1 ${controlsDisabled ? "opacity-60" : ""}`}
      data-tour-id="composer-permission"
    >
      <ActiveIcon aria-hidden="true" />
      {#if showLabel}<span class="@max-[480px]/composer-toolbar:hidden"
          >{activePermission.name}</span
        >{/if}
    </span>
  {/snippet}
  <ComposerPermissionPanel
    {activePermission}
    {permissionRuleSets}
    {loading}
    {error}
    {lockedBy}
    disabled={controlsDisabled}
    onSelect={select}
    {onRefresh}
    onOpenSettings={() => {
      open = false;
      onOpenSettings?.();
    }}
  />
</Popover>
