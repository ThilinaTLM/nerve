<!--
  One rule set in the list: a plain row that opens the rule set's detail page.
  The overrides summary is the status line.
-->
<script lang="ts">
import { PageItem } from "@nervekit/ui-kit/components/composites/page";
import type {
  PermissionPolicyConfiguration,
  PermissionRuleSetSummary,
} from "@nervekit/contracts/permissions";
import PermissionRuleSetBadges from "./PermissionRuleSetBadges.svelte";
import { overlaySummary } from "./permission-rule-sets-view";

type Props = {
  ruleSet: PermissionRuleSetSummary;
  configuration: PermissionPolicyConfiguration;
  isDefault: boolean;
  onOpen: () => void;
};

let { ruleSet, configuration, isDefault, onOpen }: Props = $props();
</script>

<PageItem
  title={ruleSet.name}
  summary={overlaySummary(configuration, ruleSet.id).label}
  {onOpen}
  openLabel={`Open ${ruleSet.name}`}
>
  {#snippet badges()}
    <PermissionRuleSetBadges {ruleSet} {isDefault} />
  {/snippet}
</PageItem>
