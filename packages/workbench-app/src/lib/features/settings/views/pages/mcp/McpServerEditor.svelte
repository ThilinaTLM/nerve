<!--
  An approved server's entry, edited on its page: Server (name, command or URL,
  description, timeout) and Environment or Headers with secrets. Changes save
  through the daemon when focus leaves the editor, on Enter, and when the page
  closes; saving records the user's approval of what they wrote. A change made
  elsewhere (the file on disk) replaces the fields unless they hold unsaved
  edits.
-->
<script lang="ts">
import { untrack } from "svelte";
import type { McpServerRow, McpTarget } from "@nervekit/contracts/mcp";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import { FieldRow } from "@nervekit/ui-kit/components/composites/page";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { saveMcpServer } from "$lib/application/mcp/mcp-api";
import { SettingsSection } from "$lib/presentation/settings";
import McpKeyValueEditor from "./McpKeyValueEditor.svelte";
import {
  entryFromForm,
  formFromEntry,
  validateMcpForm,
  type McpFormValues,
} from "./mcp-form";

let {
  row,
  target,
  onSaved,
}: {
  row: McpServerRow;
  /** Where the entry is written: its own scope's file. */
  target: McpTarget;
  /** The entry as saved (a rename changes its name). */
  onSaved: (row: McpServerRow) => void;
} = $props();

const fromRow = (source: McpServerRow) =>
  formFromEntry(source.name, source.entry, source.secrets);
/** The entry and typed secret values the form describes: equal means nothing to save. */
const signature = (values: McpFormValues) =>
  JSON.stringify(entryFromForm(values));

let form = $state<McpFormValues>(untrack(() => fromRow(row)));
let saved = $state(untrack(() => signature(form)));
let saving = $state(false);
let error = $state<string>();
let fileProblems = $state<string[]>();
let again = false;
let root = $state<HTMLElement>();

// The entry changed elsewhere (or a save came back): follow it unless the fields hold unsaved edits.
const incoming = $derived(JSON.stringify([row.name, row.entry, row.secrets]));
$effect(() => {
  void incoming;
  untrack(() => {
    const next = fromRow(row);
    if (signature(form) === saved) form = next;
    saved = signature(next);
  });
});

async function commit(replaceInvalid = false): Promise<void> {
  if (signature(form) === saved && !replaceInvalid) return;
  if (saving) {
    again = true;
    return;
  }
  const problem = validateMcpForm(form);
  if (problem) {
    error = problem;
    return;
  }
  const submitted = signature(form);
  const submission = entryFromForm(form);
  saving = true;
  error = fileProblems = undefined;
  try {
    const result = await saveMcpServer({
      target,
      name: submission.name,
      entry: submission.entry,
      ...(submission.name !== row.name ? { previousName: row.name } : {}),
      ...(Object.keys(submission.secrets).length
        ? { secrets: submission.secrets }
        : {}),
      ...(replaceInvalid ? { replaceInvalid: true } : {}),
    });
    if (result.status === "saved") {
      const next = fromRow(result.server);
      // Typed secret values are stored now; the fields show them as kept.
      if (signature(form) === submitted) form = next;
      saved = signature(next);
      onSaved(result.server);
    } else if (result.status === "invalid") {
      error = result.problems.join(" ");
    } else {
      fileProblems = result.problems;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving = false;
    if (again) {
      again = false;
      void commit();
    }
  }
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget;
  if (next instanceof Node && root?.contains(next)) return;
  void commit();
}
const onEnter = (event: KeyboardEvent) => {
  if (event.key === "Enter") void commit();
};

// Leaving the page keeps what was typed.
$effect(() => () => void commit());

const ARGS_PLACEHOLDER = "-y\n@modelcontextprotocol/server-github";
const http = $derived(form.transport === "http");
const argsRows = $derived(
  Math.min(8, Math.max(2, form.args.split("\n").length)),
);
</script>

<!-- One focus scope: moving between its fields does not save; leaving it does. -->
<div bind:this={root} class="contents" onfocusout={onFocusOut}>
  {#if error}<Callout tone="destructive" text={error} />{/if}
  {#if fileProblems}
    <Callout
      layout="block"
      tone="warning"
      title="The file on disk is not valid"
      text={`${fileProblems.join(" ")} Nothing was written.`}
    >
      {#snippet actions()}
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onclick={() => void commit(true)}>Replace with a valid file</Button
        >
      {/snippet}
    </Callout>
  {/if}

  <SettingsSection
    id="server"
    title="Server"
    description="Changes save when you leave a field."
    divided
  >
    {#snippet actions()}
      {#if saving}
        <span
          class="flex items-center gap-1.5 text-caption text-muted-foreground"
          ><Spinner class="size-3" />Saving</span
        >
      {/if}
    {/snippet}
    <FieldRow
      label="Name"
      description="How the agent refers to it."
      htmlFor="mcp-name"
    >
      {#snippet control()}
        <Input
          id="mcp-name"
          class="font-mono"
          bind:value={form.name}
          onkeydown={onEnter}
        />
      {/snippet}
    </FieldRow>
    <FieldRow label="Type">
      {#snippet control()}
        <ToggleGroup.Root
          type="single"
          variant="outline"
          size="sm"
          value={form.transport}
          aria-label="Type"
          onValueChange={(value) => {
            if (value === "stdio" || value === "http") form.transport = value;
          }}
        >
          <ToggleGroup.Item value="stdio">Local command</ToggleGroup.Item>
          <ToggleGroup.Item value="http">HTTP URL</ToggleGroup.Item>
        </ToggleGroup.Root>
      {/snippet}
    </FieldRow>
    {#if http}
      <FieldRow label="URL" layout="stacked" htmlFor="mcp-url">
        <Input
          id="mcp-url"
          class="font-mono"
          placeholder="https://example.com/mcp"
          bind:value={form.url}
          onkeydown={onEnter}
        />
      </FieldRow>
    {:else}
      <FieldRow label="Command" htmlFor="mcp-command">
        {#snippet control()}
          <Input
            id="mcp-command"
            class="font-mono"
            placeholder="npx"
            bind:value={form.command}
            onkeydown={onEnter}
          />
        {/snippet}
      </FieldRow>
      <FieldRow
        label="Arguments"
        description="One per line."
        layout="stacked"
        htmlFor="mcp-args"
      >
        <Textarea
          id="mcp-args"
          class="font-mono"
          rows={argsRows}
          spellcheck={false}
          placeholder={ARGS_PLACEHOLDER}
          bind:value={form.args}
        />
      </FieldRow>
      <FieldRow
        label="Working directory"
        description="Optional."
        layout="stacked"
        htmlFor="mcp-cwd"
      >
        <Input
          id="mcp-cwd"
          class="font-mono"
          bind:value={form.cwd}
          onkeydown={onEnter}
        />
      </FieldRow>
    {/if}
    <FieldRow
      label="Description"
      description="Optional. Shown in the list and to the agent."
      layout="stacked"
      htmlFor="mcp-description"
    >
      <Input
        id="mcp-description"
        bind:value={form.description}
        onkeydown={onEnter}
      />
    </FieldRow>
    <FieldRow
      label="Request timeout"
      description="Seconds. Optional."
      htmlFor="mcp-timeout"
    >
      {#snippet control()}
        <Input
          id="mcp-timeout"
          class="w-24"
          inputmode="numeric"
          bind:value={form.timeout}
          onkeydown={onEnter}
        />
      {/snippet}
    </FieldRow>
  </SettingsSection>

  <SettingsSection
    id="environment"
    title={http ? "Headers" : "Environment"}
    description="A secret value is stored on this computer; the file holds only a reference."
  >
    {#if http}
      <McpKeyValueEditor
        bind:rows={form.headers}
        noun="header"
        keyPlaceholder="Authorization"
        onChange={() => void commit()}
      />
    {:else}
      <McpKeyValueEditor
        bind:rows={form.env}
        noun="variable"
        keyPlaceholder="GITHUB_TOKEN"
        onChange={() => void commit()}
      />
    {/if}
  </SettingsSection>
</div>
