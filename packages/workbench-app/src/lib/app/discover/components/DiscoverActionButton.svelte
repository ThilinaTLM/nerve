<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ButtonVariant } from "@nervekit/ui-kit/components/ui/button";
import type { DiscoverAction } from "../content/entries.js";

type Props = {
  action: DiscoverAction;
  variant?: ButtonVariant;
  onAction: (action: DiscoverAction) => void;
};

let { action, variant = "outline", onAction }: Props = $props();
</script>

{#if action.kind === "external"}
  <Button
    {variant}
    size="xs"
    href={action.href}
    target="_blank"
    rel="noreferrer"
  >
    {action.label}
  </Button>
{:else}
  <Button {variant} size="xs" onclick={() => onAction(action)}>
    {action.label}
  </Button>
{/if}
