<script lang="ts">
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { TipBadge } from "$lib/presentation/settings";

type Props = { ruleSet: PermissionRuleSetSummary; isDefault: boolean };

let { ruleSet, isDefault }: Props = $props();
</script>

{#if isDefault}<TipBadge
    variant="brand"
    text="Default"
    tip="Used when a conversation doesn't choose a rule set. Change it in General."
  />{/if}
{#if !ruleSet.enabled}<Badge variant="neutral">Disabled</Badge>{/if}
