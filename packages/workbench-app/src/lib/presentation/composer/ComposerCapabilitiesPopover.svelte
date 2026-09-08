<script lang="ts">
import Blocks from "@lucide/svelte/icons/blocks";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Settings from "@lucide/svelte/icons/settings";
import type {
  CapabilityConfiguration,
  CapabilityPatch,
} from "@nervekit/contracts/capabilities";
import type { UserConfigurableToolName } from "@nervekit/contracts/tools";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import Popover, {
  PopoverBody,
  PopoverSection,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";

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

const SEARCH_THRESHOLD = 8;

const tools: Array<{ name: UserConfigurableToolName; label: string }> = [
  { name: "explore", label: "Explore" },
  { name: "web_search", label: "Web search" },
  { name: "web_fetch", label: "Web fetch" },
  { name: "explain_image", label: "Image explanation" },
  { name: "python_exec", label: "Python" },
];

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
let query = $state("");

function handleOpenChange(next: boolean): void {
  open = disabled ? false : next;
  if (!open) return;
  query = "";
  onRefresh?.();
}

$effect(() => {
  if (disabled) open = false;
});

function toolEnabled(name: UserConfigurableToolName): boolean {
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
  configuration ? tools.filter((tool) => toolEnabled(tool.name)).length : 0,
);
const enabledSkills = $derived(
  configuration ? skills.filter((skill) => skillEnabled(skill)).length : 0,
);
const triggerTitle = $derived(
  loading && !configuration
    ? "Tools and skills: loading"
    : error
      ? `Tools and skills unavailable: ${error}`
      : `Tools and skills: ${enabledTools} of ${tools.length} optional tools, ${enabledSkills} of ${skills.length} skills${overrideCount > 0 ? " · conversation overrides" : ""}`,
);

const toolRows = $derived<Row[]>(
  tools.map((tool) => ({
    key: tool.name,
    label: tool.label,
    enabled: toolEnabled(tool.name),
    overridden: conversation?.tools[tool.name] !== undefined,
    detail:
      conversation?.tools[tool.name] !== undefined
        ? "Set for this conversation"
        : "Inherited from project and user settings",
    toggle: (enabled: boolean) =>
      onPatch?.({ tools: { [tool.name]: enabled } }),
    reset: () => onPatch?.({ tools: { [tool.name]: null } }),
  })),
);

const skillRows = $derived<Row[]>(
  skills
    .filter((skill) =>
      query.trim()
        ? skill.name.toLowerCase().includes(query.trim().toLowerCase())
        : true,
    )
    .map((skill) => ({
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
      reset: () =>
        onPatch?.({ skills: { [skill.kind]: { [skill.name]: null } } }),
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
  triggerClass="composer-tab w-7 p-0 max-sm:w-7.5"
  ariaLabel="Tools and skills"
  {triggerTitle}
  side="top"
  align="end"
  sideOffset={9}
>
  {#snippet trigger()}
    <span
      class={`relative inline-flex items-center justify-center ${disabled ? "opacity-60" : ""}`}
      data-tour-id="composer-capabilities"
    >
      <Blocks size={13} strokeWidth={2.2} />
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
        {:else}
          {#if tab === "skills" && skills.length > SEARCH_THRESHOLD}
            <SearchInput
              bind:value={query}
              placeholder="Search skills"
              ariaLabel="Search skills"
            />
          {/if}

          {#if rows.length === 0}
            <p class="text-muted-foreground">
              {tab === "skills" && skills.length > 0
                ? "No skills match."
                : "No skills are available for this project."}
            </p>
          {:else}
            <div
              class="grid max-h-[min(40vh,15rem)] gap-0.5 overflow-x-hidden overflow-y-auto"
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
            </div>
          {/if}

          <p class="text-muted-foreground">
            {overrideCount > 0
              ? `${overrideCount} conversation override${overrideCount === 1 ? "" : "s"} · applies to the next run.`
              : "Changes apply to the next run."}
          </p>
        {/if}
      </div>
    </PopoverSection>
  </PopoverBody>
</Popover>
