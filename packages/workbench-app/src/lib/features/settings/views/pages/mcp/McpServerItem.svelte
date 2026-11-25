<!--
  One MCP server row, like an extension's: identity, one status line, the
  layered Enabled switches and the chevron to its page. Everything else
  (review, edit, remove) is on that page.
-->
<script lang="ts">
import Plug from "@lucide/svelte/icons/plug";
import type { McpServerRow } from "@nervekit/contracts/mcp";
import { PageItem } from "@nervekit/ui-kit/components/composites/page";
import {
  LayerSwitches,
  TrustStateBadge,
  type SettingsLayer,
} from "$lib/presentation/settings";
import {
  mcpCommandLine,
  mcpPending,
  mcpProblem,
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
}: Props = $props();

const pending = $derived(mcpPending(row));
/** The user's choice: a quiet badge, not a problem line. */
const declined = $derived(row.review === "declined");
/** Where it comes from, kept in the status line so the name never loses room. */
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
  [origin, mcpToolCount(row), row.description ?? mcpCommandLine(row)]
    .filter(Boolean)
    .join(" · "),
);
</script>

<PageItem
  title={row.name}
  icon={Plug}
  muted={row.state === "disabled"}
  {summary}
  problem={declined ? undefined : mcpProblem(row)}
  problemAction={row.review === "needs_review"
    ? { label: "Review", onclick: onOpen }
    : undefined}
  {onOpen}
  openLabel={pending ? `Review ${row.name}` : `Open ${row.name}`}
>
  {#snippet badges()}
    {#if declined}<TrustStateBadge state="declined" />{/if}
  {/snippet}
  {#snippet meta()}
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
