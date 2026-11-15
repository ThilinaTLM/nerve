<script lang="ts">
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";

type Props = { ruleSet: PermissionRuleSetSummary; isDefault: boolean };

let { ruleSet, isDefault }: Props = $props();
</script>

<Badge variant="neutral"
  >{ruleSet.source === "builtin" ? "Built-in" : "User-defined"}</Badge
>
{#if isDefault}<Badge variant="brand">Default</Badge>{/if}
{#if !ruleSet.enabled}<Badge variant="neutral">Disabled</Badge>{/if}
