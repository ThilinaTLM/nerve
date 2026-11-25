<script lang="ts">
import {
  PageItem,
  PageList,
} from "@nervekit/ui-kit/components/composites/page";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import ProjectCapabilityTrustNotice from "../capabilities/ProjectCapabilityTrustNotice.svelte";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import FolderGit2 from "@lucide/svelte/icons/folder-git-2";
import Globe from "@lucide/svelte/icons/globe";
import Sparkles from "@lucide/svelte/icons/sparkles";
import Trash2 from "@lucide/svelte/icons/trash-2";
import type { AvailableSkill } from "@nervekit/contracts/skills";
import { skillOverrideKind } from "@nervekit/contracts/skills";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { ScopedAgentState } from "$lib/application/agent-configuration/scoped-agent-state.svelte";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  skillApprovalProblem,
  skillIsPending,
} from "$lib/application/skills/skill-review";
import {
  LayerSwitches,
  OriginGroup,
  SETTINGS_SEARCH_MIN,
  SettingsSection,
  TipBadge,
  TrustStateBadge,
  type SettingsLayer,
  type SettingsOrigin,
} from "$lib/presentation/settings";
import {
  filterSkills,
  type SkillEntry,
} from "$lib/domain/skills/skill-catalog";
import type { Layered } from "../../../state/layered";
import { applyLayerChange } from "../../shared/layer-change";

let {
  projectId,
  projectName,
  skills = [],
  error: catalogError,
  onOpenItem,
}: {
  /** The open project; without one the page has a single (User) column. */
  projectId?: string;
  projectName?: string;
  skills?: AvailableSkill[];
  loading?: boolean;
  error?: string;
  /** Opens a project skill's review page. */
  onOpenItem?: (name: string) => void;
} = $props();

const userEditor = new ScopedAgentState();
const projectEditor = new ScopedAgentState();
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void userEditor.load({ scope: "user" });
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !projectId) return;
  void projectEditor.load({ scope: "project", projectId });
});
$effect(() => userEditor.observe());
$effect(() => projectEditor.observe());

const layered = $derived(!!projectId && !!projectName);
const ready = $derived(
  !!userEditor.resolution && (!layered || !!projectEditor.resolution),
);
const error = $derived(
  userEditor.error ??
    (layered ? projectEditor.error : undefined) ??
    catalogError,
);
/** The project's settings file is not trusted: its column is locked. */
const locked = $derived(
  layered &&
    projectEditor.document?.status === "available" &&
    (projectEditor.document.trustState ?? "trusted") !== "trusted",
);
let query = $state("");

const escape = (value: string) =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");
const pointer = (kind: string, name: string) =>
  `/overrides/skills/${kind}/${escape(name)}`;

type Row = {
  entry: SkillEntry;
  value: Layered<boolean>;
  user: boolean;
  project: boolean;
  projectSet: boolean;
  /** A project skill with this name replaces this one in the project. */
  replaced: boolean;
};

function stored(editor: ScopedAgentState, entry: SkillEntry) {
  return editor.overrides.skills?.[entry.kind]?.[entry.skill.name];
}
function resolved(editor: ScopedAgentState, entry: SkillEntry): boolean {
  const settings = editor.resolution?.settings.skills;
  return (
    settings?.[entry.kind]?.[entry.skill.name] ??
    settings?.defaults?.[entry.kind] ??
    false
  );
}
function builtinDefault(entry: SkillEntry): boolean {
  const inherited = userEditor.inherited?.settings.skills;
  return (
    inherited?.[entry.kind]?.[entry.skill.name] ??
    inherited?.defaults?.[entry.kind] ??
    false
  );
}

const projectNames = $derived(
  new Set(skills.filter((s) => s.source === "project").map((s) => s.name)),
);
const rows = $derived<Row[]>(
  skills
    .filter((skill) => layered || skill.source !== "project")
    .map((skill) => {
      const entry: SkillEntry = {
        skill,
        kind: skillOverrideKind(skill.source),
        source: skill.source,
        enabled: false,
        inherited: false,
        overridden: false,
      };
      const projectOwned = skill.source === "project";
      const user = resolved(userEditor, entry);
      const projectStored = layered ? stored(projectEditor, entry) : undefined;
      return {
        entry,
        // A project skill has no User layer: its default is what it inherits.
        value: {
          builtinDefault: projectOwned ? user : builtinDefault(entry),
          user: projectOwned ? undefined : stored(userEditor, entry),
          project: projectStored,
        },
        user,
        project: layered ? resolved(projectEditor, entry) : user,
        projectSet: projectStored !== undefined,
        replaced:
          layered && skill.source === "user" && projectNames.has(skill.name),
      };
    }),
);

const total = $derived(rows.length);
const visible = $derived(
  total >= SETTINGS_SEARCH_MIN
    ? filterSkills({
        entries: rows.map((r) => r.entry),
        query,
      })
    : rows.map((r) => r.entry),
);
const visibleKeys = $derived(new Set(visible.map((e) => e.skill.filePath)));

/** Project → User → other sources → Built-in. */
const groups = $derived(
  (
    [
      ["project", { kind: "project" }, FolderGit2],
      ["user", { kind: "user" }, FolderOpen],
      ["agentBrowser", { kind: "agent-browser" }, Globe],
      ["nerve", { kind: "builtin" }, Sparkles],
    ] as const
  ).map(([source, origin, icon]) => ({
    source,
    origin: origin as SettingsOrigin,
    icon,
    rows: rows.filter(
      (r) =>
        r.entry.source === source && visibleKeys.has(r.entry.skill.filePath),
    ),
  })),
);

async function write(
  editor: ScopedAgentState,
  entry: SkillEntry,
  choice: boolean | undefined,
) {
  if (choice === undefined)
    await editor.save({}, [pointer(entry.kind, entry.skill.name)]);
  else
    await editor.save({
      skills: { [entry.kind]: { [entry.skill.name]: choice } },
    });
}

function change(row: Row, layer: SettingsLayer, next: boolean) {
  void applyLayerChange({
    value: row.value,
    layer,
    next,
    writeUser: (choice) => write(userEditor, row.entry, choice),
    writeProject: (choice) => write(projectEditor, row.entry, choice),
  });
}

const orphans = $derived.by(() => {
  const result: {
    layer: SettingsLayer;
    kind: "file" | "nerve" | "agentBrowser";
    name: string;
    enabled: boolean;
  }[] = [];
  const editors: [SettingsLayer, ScopedAgentState][] = [["user", userEditor]];
  if (layered) editors.push(["project", projectEditor]);
  for (const [layer, editor] of editors)
    for (const kind of ["file", "nerve", "agentBrowser"] as const)
      for (const [name, enabled] of Object.entries(
        editor.overrides.skills?.[kind] ?? {},
      ))
        if (
          !rows.some(
            (r) => r.entry.kind === kind && r.entry.skill.name === name,
          )
        )
          result.push({ layer, kind, name, enabled });
  return result;
});
function clearOrphans(values: typeof orphans) {
  void (async () => {
    for (const layer of ["user", "project"] as const) {
      const own = values.filter((v) => v.layer === layer);
      if (own.length)
        await (layer === "user" ? userEditor : projectEditor).save(
          {},
          own.map((v) => pointer(v.kind, v.name)),
        );
    }
  })();
}

/** A project skill opens its review page; user and built-in skills have none. */
const reviewable = (entry: SkillEntry) =>
  entry.source === "project" && !!onOpenItem;
function onRetry() {
  return Promise.all([
    userEditor.reload(),
    layered ? projectEditor.reload() : undefined,
  ]);
}
</script>

{#if layered}<ProjectCapabilityTrustNotice
    document={projectEditor.document}
    scope={projectEditor.scope}
    onReload={() => projectEditor.reload()}
  />{/if}
{#if error}
  <Callout layout="block" tone="destructive" text={error}>
    {#snippet actions()}
      <Button size="sm" variant="outline" onclick={onRetry}>Retry</Button>
    {/snippet}
  </Callout>
{/if}

{#if !ready && !error}
  <Skeleton class="h-8 w-full" />
{:else if ready}
  {#if total >= SETTINGS_SEARCH_MIN}
    <SearchInput
      bind:value={query}
      placeholder="Search skills"
      ariaLabel="Search skills"
      class="max-w-xs"
    />
  {/if}

  {#each groups as group (group.source)}
    <OriginGroup
      origin={group.origin}
      count={group.rows.length}
      projectName={layered ? projectName : undefined}
      {locked}
    >
      {#each group.rows as row (row.entry.skill.filePath)}
        {@const entry = row.entry}
        <PageItem
          title={entry.skill.name}
          icon={group.icon}
          summary={entry.skill.description || entry.skill.filePath}
          mono={!entry.skill.description}
          problem={skillApprovalProblem(entry.skill)}
          problemAction={entry.skill.trustState === "needs_review"
            ? {
                label: "Review",
                onclick: () => onOpenItem?.(entry.skill.name),
              }
            : undefined}
          onOpen={reviewable(entry)
            ? () => onOpenItem?.(entry.skill.name)
            : undefined}
          openLabel={`Review ${entry.skill.name}`}
        >
          {#snippet badges()}
            {#if entry.skill.trustState === "declined"}
              <TrustStateBadge
                state="declined"
                changedSinceDecision={entry.skill.changedSinceDecision}
              />
            {/if}
            {#if row.replaced}
              <TipBadge
                text="Replaced in project"
                tip={`The project has its own ${entry.skill.name}; this one is not used there.`}
              />
            {/if}
          {/snippet}
          {#snippet meta()}
            <LayerSwitches
              name={entry.skill.name}
              user={row.user}
              project={row.project}
              projectSet={row.projectSet}
              projectName={layered ? projectName : undefined}
              projectOnly={entry.source === "project"}
              pending={skillIsPending(entry.skill)}
              inapplicable={row.replaced}
              {locked}
              onChange={(layer, next) => change(row, layer, next)}
            />
          {/snippet}
        </PageItem>
      {/each}
    </OriginGroup>
  {/each}

  {#if total === 0 && !error}
    <p class="text-ui text-muted-foreground">
      Skills come from your skills directory, {layered
        ? "this project, "
        : ""}Nerve, and the agent-browser CLI.
    </p>
  {/if}

  {#if orphans.length > 0}
    <SettingsSection
      id="unused-entries"
      title="Unused entries"
      info="Saved on/off decisions for skill names that are not installed. They do nothing today, but would apply to any future skill taking that name."
    >
      {#snippet actions()}
        <Button
          size="sm"
          variant="ghost"
          class="text-muted-foreground"
          onclick={() => clearOrphans(orphans)}
        >
          Remove all
        </Button>
      {/snippet}
      <PageList ariaLabel="Unused skill entries">
        {#each orphans as orphan (`${orphan.layer}:${orphan.kind}:${orphan.name}`)}
          <PageItem
            title={orphan.name}
            icon={orphan.kind === "agentBrowser" ? Globe : FolderOpen}
            summary={`Saved ${orphan.layer === "user" ? "for you" : "in this project"} as ${orphan.enabled ? "enabled" : "disabled"}; no skill with this name is installed.`}
          >
            {#snippet actions()}
              <IconAction
                icon={Trash2}
                tone="destructive"
                label="Remove entry"
                onclick={() => clearOrphans([orphan])}
              />
            {/snippet}
          </PageItem>
        {/each}
      </PageList>
    </SettingsSection>
  {/if}
{/if}
