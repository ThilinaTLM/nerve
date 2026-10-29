<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Plus from "@lucide/svelte/icons/plus";
import type { ProfileDefinition } from "@nervekit/contracts/agent-configuration";
import { skillOverrideKind } from "$lib/domain/skills/skill-catalog";
import PopoverPanel, {
  PopoverHeader,
  PopoverCommandList,
  PopoverViews,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  changeRows,
  buildAddChangeItems,
  type ChangeKey,
} from "./profile-changes";
import { toolRows, accountKind } from "../tools/tool-settings";
import ProfileChangeEditor from "./ProfileChangeEditor.svelte";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";
let {
  profileLabel,
  definition,
  context,
  onSave,
}: {
  profileLabel: string;
  definition: ProfileDefinition;
  context: ProfileEditContext;
  onSave: (change: ChangeDraft) => Promise<void>;
} = $props();
let open = $state(false);
let baseline = $state<ChangeKey[]>([]);
let view = $state<ChangeKey | "menu">("menu");
let error = $state<string>();
let saving = $state(false);
let editor = $state<ProfileChangeEditor>();
function setOpen(next: boolean) {
  if (next || view !== "instructions") open = next;
  else
    void editor?.flush().then((ok) => {
      if (ok) open = false;
    });
}
async function back() {
  if (await editor?.flush()) view = "menu";
}
const rows = $derived(changeRows(definition));
const items = $derived(
  buildAddChangeItems({
    baseline,
    rows,
    tools: toolRows
      .filter(
        (t) =>
          definition.usableBy !== "subagent" ||
          (t.id !== "subagents" && t.id !== "plan_present"),
      )
      .map((t) => ({
        key: `tool:${t.id}` as ChangeKey,
        label: t.label,
        description: t.description,
        account: !!accountKind(t.id),
        defaultOn: t.always
          ? undefined
          : (context.seedTool(t.id).enabled ?? true),
      })),
    skills: context.skills.map((skill) => ({
      key: `skill:${skillOverrideKind(skill.source)}:${skill.name}` as ChangeKey,
      label: skill.name,
      description: skill.source,
      defaultOn: context.skillEnabled(
        skillOverrideKind(skill.source),
        skill.name,
      ),
    })),
  }),
);
const selected = $derived(items.find((i) => i.key === view));
const draft = $derived<ChangeDraft>({
  key: view === "menu" ? "model" : view,
  mode: rows.find((row) => row.key === view)?.mode ?? "recommend",
  value:
    rows.find((row) => row.key === view)?.value ??
    (view === "compaction"
      ? { auto: true, profile: "balanced", customTriggerPercent: 80 }
      : view === "instructions"
        ? ""
        : view.startsWith("tool:")
          ? context.seedTool(
              view.slice(5) as Parameters<typeof context.seedTool>[0],
            )
          : undefined),
});
async function choose(item: (typeof items)[number]) {
  if (saving) return;
  if (!item.key.startsWith("tool:") && !item.key.startsWith("skill:")) {
    view = item.key;
    return;
  }
  saving = true;
  error = undefined;
  try {
    const existing = rows.find((r) => r.key === item.key);
    const tool = toolRows.find((t) => `tool:${t.id}` === item.key);
    if (tool?.always) {
      view = item.key;
      return;
    }
    const seed = tool ? context.seedTool(tool.id) : undefined;
    await onSave({
      key: item.key,
      mode: existing ? "settings" : "recommend",
      value: tool
        ? { ...seed, enabled: !(seed?.enabled ?? true) }
        : !(item.defaultOn ?? true),
    });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
  }
}
</script>
<PopoverPanel
  bind:open={() => open, setOpen}
  size="lg"
  align="start"
  ariaLabel={`Add a change to ${profileLabel}`}
  onOpenChange={(next) => {
    if (next) {
      baseline = rows.map((r) => r.key);
      view = "menu";
      error = undefined;
    }
  }}
>
  {#snippet triggerChild({ props })}<Button {...props} variant="ghost" size="sm"
      ><Plus class="size-3" />Add a change</Button
    >{/snippet}
  {#if open}<PopoverViews key={view}>
      {#if view === "menu"}
        <PopoverHeader title="Add a change" meta={profileLabel} />
        {#if error}<p role="alert" class="px-3 text-xs text-destructive">
            {error}
          </p>{/if}
        <PopoverCommandList
          {items}
          ariaLabel="Settings to change"
          placeholder="Search settings, tools, skills…"
          onChoose={choose}
          isDisabled={() => saving}
          isSelected={(item) => rows.some((r) => r.key === item.key)}
        >
          {#snippet row(item)}
            <span class="flex min-w-0 flex-1 items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-foreground"
                >{item.label}</span
              >
              {#if item.flip}
                <span
                  class="flex flex-none items-center gap-1 text-muted-foreground"
                  aria-label={item.flip.applied
                    ? `Changed from ${item.flip.from} to ${item.flip.to}; choose to undo`
                    : `Turns ${item.flip.to.toLowerCase()}, default is ${item.flip.from.toLowerCase()}`}
                >
                  <span>{item.flip.from}</span>
                  <ArrowRight class="size-3" aria-hidden="true" />
                  <span
                    class={item.flip.to === "On"
                      ? "font-medium text-success"
                      : "font-medium text-foreground"}>{item.flip.to}</span
                  >
                </span>
              {:else}
                <ChevronRight
                  class="size-3.5 flex-none text-muted-foreground"
                  aria-hidden="true"
                />
              {/if}
            </span>
          {/snippet}
        </PopoverCommandList>
      {:else}
        <ProfileChangeEditor
          bind:this={editor}
          title={selected?.label ?? view}
          change={draft}
          {context}
          usableBy={definition.usableBy}
          {onSave}
          onBack={back}
        />
      {/if}
    </PopoverViews>{/if}
</PopoverPanel>
