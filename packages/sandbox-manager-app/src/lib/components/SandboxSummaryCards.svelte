<script lang="ts">
import { Boxes, CircleAlert, Clock, Play } from "@lucide/svelte";
import SandboxStatStrip from "./SandboxStatStrip.svelte";
import { useSandboxManagerStore } from "../state/sandbox-manager-state.svelte";
import { fleetSummary } from "../state/sandbox-manager-selectors.svelte";

const store = useSandboxManagerStore();
const summary = $derived(fleetSummary(store));

const cards = $derived([
  {
    label: "Sandboxes",
    value: summary.total,
    icon: Boxes,
    tone: "text-foreground",
  },
  {
    label: "Running",
    value: summary.running,
    icon: Play,
    tone: "text-success",
  },
  {
    label: "Degraded / failed",
    value: summary.degraded + summary.failed,
    icon: CircleAlert,
    tone: "text-destructive",
  },
  {
    label: "Pending waits",
    value: summary.pendingWaits,
    icon: Clock,
    tone: "text-warning",
  },
]);
</script>

<SandboxStatStrip items={cards} />
