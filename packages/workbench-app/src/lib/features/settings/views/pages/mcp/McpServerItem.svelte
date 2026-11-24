<!-- One MCP server row: identity, state, enabled switches and its actions. -->
<script lang="ts">
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import Plug from "@lucide/svelte/icons/plug";
import type { McpServerRow } from "@nervekit/contracts/mcp";
import { PageItem } from "@nervekit/ui-kit/components/composites/page";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { LayerSwitches, type SettingsLayer } from "$lib/presentation/settings";
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
  /** Opens the server's page (its review while it waits for one). */
  onOpen: () => void;
  onEdit: () => void;
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
  onEdit,
  onDisconnect,
  onRemove,
}: Props = $props();

const pending = $derived(mcpPending(row));
const badge = $derived(mcpStateBadge(row.state));
const toolCount = $derived(mcpToolCount(row));
/** Where it comes from, kept in the status line so the name never loses room to badges. */
const origin = $derived(
  row.shadowed
    ? "Replaced in project"
    : row.replacesUser
      ? "Replaces yours"
      : row.inherited
        ? "From your settings"
        : undefined,
);
const summary = $derived(
  [origin, toolCount, row.description ?? mcpCommandLine(row)]
    .filter(Boolean)
    .join(" · "),
);
</script>

<PageItem
  title={row.name}
  icon={Plug}
  muted={row.state === "disabled"}
  {summary}
  mono={!row.description && !toolCount && !origin}
  problem={mcpProblem(row)}
  problemAction={pending ? { label: "Review", onclick: onOpen } : undefined}
  {onOpen}
  openLabel={pending ? `Review ${row.name}` : `Open ${row.name}`}
>
  {#snippet badges()}
    <!-- Narrow pages drop the badge so the name keeps its room; a problem line still says why a row is not working. -->
    <Badge variant={badge.variant} class="hidden @xl/page:inline-flex"
      >{badge.label}</Badge
    >
  {/snippet}
  {#snippet meta()}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={`More actions for ${row.name}`}
      >
        <Ellipsis class="size-4" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-40">
        {#if !pending}
          <DropdownMenu.Item onSelect={onEdit}>Edit</DropdownMenu.Item>
          {#if row.state === "connected"}
            <DropdownMenu.Item onSelect={onDisconnect}
              >Disconnect</DropdownMenu.Item
            >
          {/if}
          <DropdownMenu.Separator />
        {/if}
        <DropdownMenu.Item onSelect={onRemove}>Remove</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
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
