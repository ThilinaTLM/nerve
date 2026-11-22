<!--
  The Agents / Sub-Agents list: one group per origin (project, user, built-in),
  one row per profile with a summary of its changes. Sub-agent rows carry the
  launch switches; main agents are chosen, not switched.
-->
<script lang="ts">
import Bot from "@lucide/svelte/icons/bot";
import Copy from "@lucide/svelte/icons/copy";
import Users from "@lucide/svelte/icons/users";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import SearchInput from "@nervekit/ui-kit/components/composites/search-input";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  LayerSwitches,
  OriginGroup,
  SETTINGS_SEARCH_MIN,
  SettingsItem,
  TipBadge,
} from "$lib/presentation/settings";
import { changeRows } from "./profile-changes";
import type { ProfileOrigin, ProfileRow } from "./profile-groups";
import type { ProfileKind } from "./profile-kind";
import { changeSummary, type ChangeTextDeps } from "./profile-summary";
import type { ProfilesStore } from "./profiles-store.svelte";

let {
  store,
  kind,
  projectName,
  textDeps,
  onOpen,
  onNew,
  onDuplicate,
}: {
  store: ProfilesStore;
  kind: ProfileKind;
  projectName?: string;
  textDeps: ChangeTextDeps;
  onOpen: (id: string) => void;
  onNew: (layer: "user" | "project") => void;
  onDuplicate: (row: ProfileRow) => void;
} = $props();

let query = $state("");
const sub = $derived(kind === "subagent");
const groups = $derived(store.rows(kind));
const total = $derived(
  groups.project.length + groups.user.length + groups.builtin.length,
);
const origins = $derived<ProfileOrigin[]>([
  ...(store.projectId ? (["project"] as const) : []),
  "user",
  "builtin",
]);
const needle = $derived(query.trim().toLowerCase());
const shown = (origin: ProfileOrigin) =>
  groups[origin].filter(
    (row) =>
      !needle ||
      `${row.entry.definition?.label ?? ""} ${row.name} ${row.entry.definition?.whenToUse ?? ""}`
        .toLowerCase()
        .includes(needle),
  );

function problemOf(row: ProfileRow): string | undefined {
  if (!row.entry.definition) return "This file can't be read";
  if (row.origin === "project" && !row.entry.trusted)
    return "Waiting for your review";
  return undefined;
}
</script>

{#if total >= SETTINGS_SEARCH_MIN}
  <SearchInput
    bind:value={query}
    placeholder="Search profiles"
    ariaLabel="Search profiles"
    class="max-w-xs"
  />
{/if}

{#each origins as origin (origin)}
  {@const rows = shown(origin)}
  <OriginGroup
    origin={{ kind: origin }}
    count={rows.length}
    {projectName}
    layers={sub}
    locked={store.launchLocked}
    emptyText={origin === "builtin" || needle
      ? undefined
      : "No profiles here yet"}
    emptyDescription="Duplicate a profile, or start a new one."
  >
    {#snippet emptyAction()}
      <Button
        size="sm"
        variant="outline"
        onclick={() => onNew(origin === "project" ? "project" : "user")}
        >New profile</Button
      >
    {/snippet}
    {#each rows as row (row.id)}
      {@const definition = row.entry.definition}
      {@const problem = problemOf(row)}
      <SettingsItem
        title={definition?.label ?? row.name}
        icon={sub ? Users : Bot}
        muted={!!row.replacedBy}
        summary={definition
          ? changeSummary(changeRows(definition), textDeps)
          : undefined}
        {problem}
        problemAction={problem
          ? { label: "Review", onclick: () => onOpen(row.id) }
          : undefined}
        onOpen={() => onOpen(row.id)}
        openLabel={`Open ${definition?.label ?? row.name}`}
      >
        {#snippet badges()}
          {#if definition?.usableBy === "both"}
            <TipBadge
              text="Both"
              tip="Usable as the main agent and as a sub-agent."
            />
          {/if}
          {#if row.replaces}
            <TipBadge
              text={row.replaces === "builtin"
                ? "Replaces built-in"
                : "Replaces your copy"}
              tip="Same ID as a profile from a lower level, so this copy is used instead."
            />
          {/if}
          {#if row.replacedBy}
            <TipBadge
              text="Replaced by the project copy"
              tip="The project has a profile with the same ID, which is used instead of this one there."
            />
          {/if}
        {/snippet}
        {#snippet meta()}
          {#if definition}
            <IconAction
              icon={Copy}
              label={`Duplicate ${row.name}`}
              disabled={!!store.busy}
              onclick={() => onDuplicate(row)}
            />
          {/if}
          {#if sub && definition && definition.usableBy !== "lead"}
            {@const launch = store.launch(row)}
            <LayerSwitches
              name={`${definition.label ?? row.name} launches`}
              user={launch.user}
              project={launch.project}
              projectSet={launch.projectSet}
              {projectName}
              projectOnly={origin === "project"}
              pending={!!problem}
              inapplicable={!!row.replacedBy}
              locked={store.launchLocked}
              onChange={(layer, next) => void store.setLaunch(row, layer, next)}
            />
          {/if}
        {/snippet}
      </SettingsItem>
    {/each}
  </OriginGroup>
{/each}
