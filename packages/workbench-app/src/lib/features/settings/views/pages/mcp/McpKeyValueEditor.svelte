<!--
  Environment variables or headers of an MCP entry. A value can be marked
  secret: it is then stored in the credential vault and the file only holds a
  reference. A stored secret is never shown; a blank field keeps it.
-->
<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import type { McpKeyValue } from "./mcp-form";

let {
  rows = $bindable(),
  noun,
  keyPlaceholder,
  onChange,
}: {
  rows: McpKeyValue[];
  /** "variable" or "header". */
  noun: string;
  keyPlaceholder: string;
  /** A row was removed, switched to or from secret, or Enter was pressed: save now. */
  onChange?: () => void;
} = $props();

const onEnter = (event: KeyboardEvent) => {
  if (event.key === "Enter") onChange?.();
};
const add = () => (rows = [...rows, { key: "", value: "", secret: false }]);
const remove = (index: number) => {
  rows = rows.filter((_, i) => i !== index);
  onChange?.();
};
</script>

<div class="grid gap-2">
  {#each rows as row, index (index)}
    <div class="flex items-center gap-2">
      <Input
        class="w-40 flex-none"
        placeholder={keyPlaceholder}
        ariaLabel={`Name of ${noun} ${index + 1}`}
        bind:value={row.key}
        onkeydown={onEnter}
      />
      <Input
        class="min-w-0 flex-1"
        type={row.secret ? "password" : "text"}
        autocomplete="off"
        placeholder={row.secret
          ? row.stored
            ? "Stored; leave blank to keep"
            : "Not set"
          : "Value"}
        ariaLabel={`Value of ${noun} ${index + 1}`}
        bind:value={row.value}
        onkeydown={onEnter}
      />
      <Label
        class="flex flex-none items-center gap-1.5 text-ui text-muted-foreground"
      >
        <Checkbox
          checked={row.secret}
          onCheckedChange={(checked) => {
            row.secret = checked === true;
            if (!row.secret) row.stored = false;
            onChange?.();
          }}
        />
        Secret
      </Label>
      <IconAction
        icon={X}
        label={`Remove ${noun}`}
        onclick={() => remove(index)}
      />
    </div>
  {/each}
  <div>
    <Button size="sm" variant="ghost" onclick={add}
      ><Plus class="size-3.5" />Add {noun}</Button
    >
  </div>
</div>
