<!-- One MCP server row: identity, state, enabled switches and its actions. -->
<script lang="ts">
import Eye from "@lucide/svelte/icons/eye";
import FlaskConical from "@lucide/svelte/icons/flask-conical";
import Pencil from "@lucide/svelte/icons/pencil";
import Plug from "@lucide/svelte/icons/plug";
import Trash2 from "@lucide/svelte/icons/trash-2";
import Unplug from "@lucide/svelte/icons/unplug";
import type { McpServerRow } from "@nervekit/contracts/mcp";
import { PageItem } from "@nervekit/ui-kit/components/composites/page";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import {
  LayerSwitches,
  TipBadge,
  type SettingsLayer,
} from "$lib/presentation/settings";
import {
  mcpCommandLine,
  mcpPending,
  mcpProblem,
  mcpStateBadge,
  mcpToolCount,
} from "./mcp-view";

type Props = {
  row: McpServerRow;
  /** The open project's name; without one there is only the User switch. */
  projectName?: string;
  user: boolean;
  project: boolean;
  projectSet: boolean;
  /** The project's settings file is not trusted. */
  locked?: boolean;
  onChange: (layer: SettingsLayer, next: boolean) => void;
  onOpen: () => void;
  onTest: () => void;
  onEdit: () => void;
  onReview: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
};

let {
  row,
  projectName,
  user,
  project,
  projectSet,
  locked = false,
  onChange,
  onOpen,
  onTest,
  onEdit,
  onReview,
  onDisconnect,
  onRemove,
}: Props = $props();

const pending = $derived(mcpPending(row));
const badge = $derived(mcpStateBadge(row.state));
const toolCount = $derived(mcpToolCount(row));
const summary = $derived(
  [toolCount, row.description ?? mcpCommandLine(row)]
    .filter(Boolean)
    .join(" · "),
);
</script>

<PageItem
  title={row.name}
  icon={Plug}
  muted={row.state === "disabled"}
  {summary}
  mono={!row.description && !toolCount}
  problem={mcpProblem(row)}
  problemAction={pending ? { label: "Review", onclick: onReview } : undefined}
  {onOpen}
  openLabel={pending ? `Review ${row.name}` : `Show what ${row.name} offers`}
>
  {#snippet badges()}
    <Badge variant={badge.variant}>{badge.label}</Badge>
    {#if row.inherited}
      <TipBadge
        text="From your settings"
        tip="Defined in your user settings. It applies in every project."
      />
    {/if}
    {#if row.replacesUser}
      <TipBadge
        text="Replaces yours"
        tip={`This project's ${row.name} is used here instead of yours${pending ? ", once you approve it" : ""}.`}
      />
    {/if}
    {#if row.shadowed}
      <TipBadge
        text="Replaced in project"
        tip={`The project has its own ${row.name}; this one is not used there.`}
      />
    {/if}
  {/snippet}
  {#snippet meta()}
    <div class="flex w-28 flex-none items-center justify-end">
      {#if pending}
        <IconAction icon={Eye} label="Review" onclick={onReview} />
      {:else}
        <IconAction icon={FlaskConical} label="Test" onclick={onTest} />
        <IconAction icon={Pencil} label="Edit" onclick={onEdit} />
        {#if row.state === "connected"}
          <IconAction icon={Unplug} label="Disconnect" onclick={onDisconnect} />
        {/if}
      {/if}
      <IconAction
        icon={Trash2}
        tone="destructive"
        label="Remove"
        onclick={onRemove}
      />
    </div>
    <LayerSwitches
      name={row.name}
      {user}
      {project}
      {projectSet}
      {projectName}
      projectOnly={row.scope === "project"}
      {pending}
      inapplicable={row.shadowed}
      {locked}
      {onChange}
    />
  {/snippet}
</PageItem>
