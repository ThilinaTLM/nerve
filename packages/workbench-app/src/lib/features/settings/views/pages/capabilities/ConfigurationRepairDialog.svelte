<script lang="ts">
import type { ScopedConfigurationTarget } from "@nervekit/contracts/agent-configuration";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { EntityRow, SettingsInlineMessage } from "$lib/presentation/settings";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import {
  ConfigurationRepair,
  type RepairState,
} from "../../../state/configuration-repair";
let {
  open = $bindable(false),
  target,
  replacement,
  onRepaired,
}: {
  open?: boolean;
  target: ScopedConfigurationTarget;
  replacement: unknown;
  onRepaired: () => void | Promise<void>;
} = $props();
const uid = $props.id();
let text = $state("");
let parseError = $state<string>();
let repair = $state<RepairState>({ busy: false });
const session = new ConfigurationRepair(
  {
    preview: (input) =>
      requestWorkbench("agentConfiguration.repairPreview", input),
    apply: (input) => requestWorkbench("agentConfiguration.repairApply", input),
  },
  (next) => {
    repair = next;
  },
);
let wasOpen = false;
$effect(() => {
  if (open && !wasOpen) {
    text = JSON.stringify(replacement, null, 2);
    parseError = undefined;
    session.dismiss();
  }
  wasOpen = open;
});
async function preview() {
  parseError = undefined;
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    parseError = "Enter valid JSON before previewing.";
    return;
  }
  await session.preview({ target, replacement: candidate });
}
async function apply() {
  if (await session.apply()) await onRepaired();
}
</script>
<Dialog
  {open}
  onOpenChange={(next) => {
    if (!repair.busy) {
      open = next;
      if (!next) session.dismiss();
    }
  }}
  title="Repair configuration"
  description="Preview a complete replacement; omitted fields are removed. Only explicit confirmation writes it with an original-byte backup and receipt. Dismissal does not repair, reset or grant trust."
>
  <EntityRow
    label="Repair target"
    value={`${target.document}${target.document === "profile" ? `:${target.name}` : ""} · ${target.scope.scope}${target.scope.scope === "project" ? `:${target.scope.projectId}` : target.scope.scope === "conversation" ? `:${target.scope.conversationId}` : ""}`}
  />
  {#if parseError || repair.error}<SettingsInlineMessage
      tone="destructive"
      text={parseError ?? repair.error}
    />{/if}
  {#if repair.result}
    <SettingsInlineMessage
      tone="success"
      text="Repair saved. Trust was not granted by this repair."
    />
    <EntityRow
      label="Original-byte backup"
      value={repair.result.backupPath ?? "No original file"}
    />
    <EntityRow label="Receipt" value={repair.result.receiptPath} />
    <EntityRow label="Directory durability" value={repair.result.durability} />
  {:else}
    <div class="grid gap-2">
      <Label for={`${uid}-candidate`}>Replacement JSON</Label><Textarea
        id={`${uid}-candidate`}
        class="font-mono"
        rows={10}
        value={text}
        disabled={repair.busy}
        oninput={(event) => {
          text = event.currentTarget.value;
          session.edited();
          parseError = undefined;
        }}
      />
    </div>
    {#if repair.preview}
      <EntityRow label="Source digest" value={repair.preview.sourceDigest} />
      <EntityRow
        label="Candidate digest"
        value={repair.preview.candidateDigest}
      />
      <p class="text-ui font-medium">Changed fields</p>
      {#each repair.preview.changedPaths as pointer (pointer)}<p
          class="font-mono text-ui"
        >
          {pointer || "/"}
        </p>{/each}
      {#if repair.preview.resolution?.diagnostics.length}<SettingsInlineMessage
          tone="warning"
          text={repair.preview.resolution.diagnostics
            .map((d) => `${d.code}: ${d.pointer}`)
            .join(" · ")}
        />{/if}
    {/if}
  {/if}
  {#snippet footer()}
    <Button
      variant="ghost"
      disabled={repair.busy}
      onclick={() => {
        session.dismiss();
        open = false;
      }}>{repair.result ? "Close" : "Dismiss"}</Button
    >
    {#if !repair.result}<Button
        variant="outline"
        disabled={repair.busy}
        onclick={preview}>Preview repair</Button
      ><Button disabled={repair.busy || !repair.preview} onclick={apply}
        >{repair.busy ? "Working…" : "Confirm repair"}</Button
      >{/if}
  {/snippet}
</Dialog>
