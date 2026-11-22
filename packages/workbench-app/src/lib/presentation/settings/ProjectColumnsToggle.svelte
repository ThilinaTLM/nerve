<!--
  Page-header switch of the User-only pages (General, Tools): "Project
  overrides" adds the project column next to User. The badge counts the
  settings the project changes on the page and is hidden at 0. A labelled
  switch, so its state reads at a glance.
-->
<script lang="ts">
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

type Props = {
  id: string;
  checked: boolean;
  /** Settings the project changes on this page. */
  count: number;
  onCheckedChange: (checked: boolean) => void;
};

let { id, checked, count, onCheckedChange }: Props = $props();

const tip = $derived(
  `Show this project's values next to yours. ${
    count === 0
      ? "The project uses all of yours."
      : `The project changes ${count} ${count === 1 ? "setting" : "settings"}.`
  }`,
);
</script>

<Tooltip.Provider delayDuration={300}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <label
          {...props}
          for={id}
          class="flex h-8 cursor-pointer items-center gap-2 text-ui text-muted-foreground hover:text-foreground"
        >
          <Switch {id} {checked} {onCheckedChange} />
          <span class="truncate">Project overrides</span>
          {#if count > 0}<Badge variant="brand">{count}</Badge>{/if}
        </label>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">{tip}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
