<script lang="ts">
import Blocks from "@lucide/svelte/icons/blocks";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Settings from "@lucide/svelte/icons/settings";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
  CapabilityToolName,
} from "@nervekit/contracts/capabilities";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import Popover, {
  PopoverBody,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { ItemScrollRegion } from "$lib/presentation/items";
import { capabilityToolLabels } from "./capability-tool-labels";

type CapabilitySkill = { name: string; kind: "file" | "agentBrowser" };
type Row = {
  key: string;
  label: string;
  enabled: boolean;
  overridden: boolean;
  detail: string;
  toggle: (enabled: boolean) => void;
  reset: () => void;
};

type Props = {
  configuration?: CapabilityConfiguration;
  skills?: CapabilitySkill[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  onPatch?: (patch: CapabilityPatch) => void;
  onReset?: () => void;
  onRefresh?: () => void;
  onOpenSettings?: (page: "tools" | "skills") => void;
};
let {
  configuration,
  skills = [],
  loading = false,
  error,
  disabled = false,
  onPatch,
  onReset,
  onRefresh,
  onOpenSettings,
}: Props = $props();

let open = $state(false);
let tab = $state<"tools" | "skills">("tools");

function handleOpenChange(next: boolean): void {
  open = disabled ? false : next;
  if (open) onRefresh?.();
}

$effect(() => {
  if (disabled) open = false;
});

const tools = $derived<CapabilityToolName[]>(
  configuration?.availableTools ?? [],
);

function toolEnabled(name: CapabilityToolName): boolean {
  return !configuration?.effective.disabledTools.includes(name);
}

function skillEnabled(skill: CapabilitySkill): boolean {
  return skill.kind === "agentBrowser"
    ? Boolean(
        configuration?.effective.enabledAgentBrowserSkills.includes(skill.name),
      )
    : !configuration?.effective.disabledFileSkills.includes(skill.name);
}

const conversation = $derived(configuration?.conversation);
const overrideCount = $derived(
  conversation
    ? Object.keys(conversation.tools).length +
        Object.keys(conversation.skills.file).length +
        Object.keys(conversation.skills.agentBrowser).length
    : 0,
);
const enabledTools = $derived(
  configuration ? tools.filter((name) => toolEnabled(name)).length : 0,
);
const enabledSkills = $derived(
  configuration ? skills.filter((skill) => skillEnabled(skill)).length : 0,
);
const triggerTitle = $derived(
  loading && !configuration
    ? "Tools and skills: loading"
    : error
      ? `Tools and skills unavailable: ${error}`
      : `Tools and skills: ${enabledTools} of ${tools.length} optional tools, ${enabledSkills} of ${skills.length} skills enabled${overrideCount > 0 ? " · conversation overrides" : ""}`,
);

const toolRows = $derived<Row[]>(
  tools.map((name) => ({
    key: name,
    label: capabilityToolLabels[name],
    enabled: toolEnabled(name),
    overridden: conversation?.tools[name] !== undefined,
    detail:
      conversation?.tools[name] !== undefined
        ? "Set for this conversation"
        : "Inherited from project and user settings",
    toggle: (enabled: boolean) => onPatch?.({ tools: { [name]: enabled } }),
    reset: () => onPatch?.({ tools: { [name]: null } }),
  })),
);

const skillRows = $derived<Row[]>(
  skills.map((skill) => ({
    key: `${skill.kind}:${skill.name}`,
    label: skill.name,
    enabled: skillEnabled(skill),
    overridden: conversation?.skills[skill.kind][skill.name] !== undefined,
    detail:
      conversation?.skills[skill.kind][skill.name] !== undefined
        ? "Set for this conversation"
        : "Inherited from project and user settings",
    toggle: (enabled: boolean) =>
      onPatch?.({ skills: { [skill.kind]: { [skill.name]: enabled } } }),
    reset: () => onPatch?.({ skills: { [skill.kind]: { [skill.name]: null } } }),
  })),
);

const rows = $derived(tab === "tools" ? toolRows : skillRows);

function openSettings(): void {
  open = false;
  onOpenSettings?.(tab);
}
</script>

<Popover
  {open}
  onOpenChange={handleOpenChange}
  size="lg"
  triggerClass="composer-tab gap-1 px-1.5 max-sm:px-1"
  ariaLabel="Tools and skills"
  {triggerTitle}
  side="top"
  align="end"
  sideOffset={9}
>
  {#snippet trigger()}
    <span
      class={`relative inline-flex items-center gap-1 ${disabled ? "opacity-60" : ""}`}
      data-tour-id="composer-capabilities"
    >
      <Blocks size={13} strokeWidth={2.2} aria-hidden="true" />
      <span>{enabledTools}/{enabledSkills}</span>
      {#if overrideCount > 0}
        <span
          class="absolute -top-1 -right-1.5 size-1.5 rounded-full bg-primary"
        ></span>
      {/if}
    </span>
  {/snippet}

  <PopoverBody>
    <PopoverSection label="Tools and skills">
      {#snippet action()}
        <div class="flex items-center gap-0.5 self-center">
          {#if overrideCount > 0}
            <Button
              size="icon-xs"
              variant="ghost"
              ariaLabel="Reset conversation tool and skill overrides"
              title={`Reset ${overrideCount} conversation override${overrideCount === 1 ? "" : "s"}`}
              onclick={() => onReset?.()}
            >
              <RotateCcw class="size-3.5" aria-hidden="true" />
            </Button>
          {/if}
          <Button
            size="icon-xs"
            variant="ghost"
            ariaLabel="Open tool and skill settings"
            title="Open tool and skill settings"
            onclick={openSettings}
          >
            <Settings class="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      {/snippet}

      <div class="grid gap-2">
        <ToggleGroup.Root
          type="single"
          size="xs"
          spacing={1}
          variant="chip"
          value={tab}
          class="justify-start"
          aria-label="Capability kind"
          onValueChange={(value) => {
            if (value) tab = value as "tools" | "skills";
          }}
        >
          <ToggleGroup.Item value="tools" class="flex-none gap-1.5 text-xs">
            Tools
            <span class="text-muted-foreground"
              >{enabledTools}/{tools.length}</span
            >
          </ToggleGroup.Item>
          <ToggleGroup.Item value="skills" class="flex-none gap-1.5 text-xs">
            Skills
            <span class="text-muted-foreground"
              >{enabledSkills}/{skills.length}</span
            >
          </ToggleGroup.Item>
        </ToggleGroup.Root>

        {#if error}
          <p class="text-warning" role="alert">{error}</p>
        {:else if loading && !configuration}
          <div class="grid gap-1.5" aria-hidden="true">
            <Skeleton class="h-6 w-full" />
            <Skeleton class="h-6 w-full" />
            <Skeleton class="h-6 w-full" />
          </div>
        {:else if rows.length === 0}
          <p class="text-muted-foreground">
            {tab === "skills"
              ? "No skills are available for this project."
              : "No optional tools are available."}
          </p>
        {:else}
          <ItemScrollRegion
            class="max-h-[min(40vh,15rem)]"
            ariaLabel={tab === "tools" ? "Optional tools" : "Available skills"}
            contentClass="grid gap-0.5"
          >
            {#each rows as row (row.key)}
              <div
                class="flex min-h-7 items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-accent/60"
              >
                <span class="min-w-0 flex-1 truncate" title={row.detail}
                  >{row.label}</span
                >
                {#if row.overridden}
                  <IconAction
                    icon={RotateCcw}
                    size="xs"
                    label={`Reset ${row.label} to the inherited setting`}
                    onclick={row.reset}
                  />
                {/if}
                <Switch
                  size="sm"
                  checked={row.enabled}
                  disabled={disabled || loading}
                  aria-label={`Enable ${row.label} for this conversation`}
                  onCheckedChange={row.toggle}
                />
              </div>
            {/each}
          </ItemScrollRegion>
        {/if}

        <p class="text-muted-foreground">
          {overrideCount > 0
            ? `${overrideCount} conversation override${overrideCount === 1 ? "" : "s"} · applies to the next run.`
            : "Changes apply to the next run."}
        </p>
      </div>
    </PopoverSection>
  </PopoverBody>
</Popover>
