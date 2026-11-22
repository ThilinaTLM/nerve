<!--
  The two fixed slots every layered row ends with: [User] [Project]. Each shows
  the effective value at that layer. The component only emits intent
  (`onChange(layer, value)`); callers decide what that means for the stored
  layers (e.g. a project value equal to User's means "follow User").
  `projectOnly` leaves the User slot empty at the same width. Cells are the
  shared `LayerCells`, so switches line up with the column labels. `locked` (the
  project's settings file is not trusted) leaves the project switch disabled
  and muted, showing User's value and centered like the others; the column
  label carries the one lock, so rows get no icon.
-->
<script lang="ts">
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import HoverTip from "./HoverTip.svelte";
import LayerCells from "./LayerCells.svelte";
import { lockedColumnTip, type SettingsLayer } from "./settings-origin";

type Props = {
  /** Item name, for the switches' accessible labels. */
  name: string;
  /** Effective value at User level. */
  user: boolean;
  /** Effective value in the project (the User value while the project follows it). */
  project?: boolean;
  /** The project sets its own value (otherwise it follows User). */
  projectSet?: boolean;
  /** The open project's name; without one there is only the User slot. */
  projectName?: string;
  /** Defined by the project: there is no User layer. */
  projectOnly?: boolean;
  /** Waiting for review: no switches until approved (the row says why). */
  pending?: boolean;
  /** The project layer does not apply here; the row's badge says why. */
  inapplicable?: boolean;
  /** The project's settings file is not trusted: its switch is disabled and shows User's value. */
  locked?: boolean;
  onChange: (layer: SettingsLayer, value: boolean) => void;
};

let {
  name,
  user,
  project,
  projectSet = false,
  projectName,
  projectOnly = false,
  pending = false,
  inapplicable = false,
  locked = false,
  onChange,
}: Props = $props();

const onOff = (value: boolean) => (value ? "on" : "off");
const effectiveProject = $derived(project ?? user);
const projectTip = $derived(
  projectSet
    ? `${projectName}: set here. Switch to ${onOff(user)} to follow User again.`
    : `${projectName}: follows User (${onOff(user)})`,
);
</script>

{#snippet userCell()}
  {#if !pending && !projectOnly}
    <HoverTip
      delay={400}
      tip={`User: ${onOff(user)} in every project${projectName ? " that doesn't set its own" : ""}`}
    >
      <Switch
        checked={user}
        aria-label={`${name} at User level`}
        onCheckedChange={(value) => onChange("user", value)}
      />
    </HoverTip>
  {/if}
{/snippet}
{#snippet projectCell()}
  {#if pending || inapplicable}
    <!-- Empty: the row explains it. -->
  {:else if locked}
    <HoverTip delay={400} tip={lockedColumnTip(projectName ?? "the project")}>
      <Switch
        checked={user}
        disabled
        aria-label={`${name} in ${projectName}`}
      />
    </HoverTip>
  {:else}
    <HoverTip delay={400} tip={projectTip}>
      <Switch
        checked={effectiveProject}
        aria-label={`${name} in ${projectName}`}
        onCheckedChange={(value) => onChange("project", value)}
      />
    </HoverTip>
  {/if}
{/snippet}

<LayerCells {projectName} user={userCell} project={projectCell} />
