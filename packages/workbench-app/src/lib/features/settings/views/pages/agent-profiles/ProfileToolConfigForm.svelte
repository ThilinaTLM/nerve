<!-- Full settings of one tool change, opened from its popover's Configure. -->
<script lang="ts">
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { Switch } from "@nervekit/ui-kit/components/ui/switch";
import ToolConfigForm from "../tools/ToolConfigForm.svelte";
import { toolRow, type ToolId, type ToolPayload } from "../tools/tool-settings";
import type { ChangeDraft, ProfileEditContext } from "./profile-edit-context";

let {
  draft = $bindable(),
  context,
  valid = $bindable(true),
}: {
  draft: ChangeDraft;
  context: ProfileEditContext;
  valid?: boolean;
} = $props();

const tool = $derived(draft.key.slice(5) as ToolId);
const payload = $derived((draft.value ?? {}) as ToolPayload);
</script>

<div class="grid gap-4">
  {#if !toolRow(tool).always}
    <div class="flex items-center justify-between gap-4">
      <Label for="change-tool-enabled"
        >Turn {payload.enabled ? "on" : "off"}</Label
      >
      <Switch
        id="change-tool-enabled"
        checked={payload.enabled === true}
        aria-label="Enable tool"
        onCheckedChange={(enabled) =>
          (draft = { ...draft, value: { ...payload, enabled } })}
      />
    </div>
  {/if}
  {#if payload.enabled || toolRow(tool).always}
    <ToolConfigForm
      name={tool}
      bind:payload={() => payload, (value) => (draft = { ...draft, value })}
      bind:valid
      models={context.models}
      accounts={context.accountsFor(tool)}
      noAccountLabel="Use the account from settings"
      leadProfiles={context.leadProfiles}
    />
  {/if}
</div>
