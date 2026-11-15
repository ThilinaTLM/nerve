<!--
  Shown only when a value differs from where it would otherwise come from: a
  user setting that differs from the built-in default, or a project setting
  that differs from the user's. A single ↺ both marks the change and puts the
  inherited value back; its tooltip names that value. The current value is
  already visible in the row's control.
-->
<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import IconAction from "@nervekit/ui-kit/components/composites/icon-action";

type Props = {
  /** The scope being edited; decides the inherited layer's name. */
  scope: "user" | "project";
  /** The inherited value, e.g. "Claude Sonnet 4.5". */
  from: string;
  onReset: () => void;
};

let { scope, from, onReset }: Props = $props();

const label = $derived(
  `${scope === "project" ? "Reset to user setting" : "Reset to default"} (${from})`,
);
</script>

<IconAction icon={RotateCcw} {label} class="-my-1 size-5" onclick={onReset} />
