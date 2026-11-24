<!--
  Add one MCP server (a server is edited on its own page). The form and the
  JSON are two views of the same entry: JSON accepts an `mcpServers` snippet
  from a server's README (or one entry) and fills the form. Saving goes through the daemon, which validates,
  stores secrets and records the approval; a file that is invalid on disk is
  replaced only when the user chooses to.
-->
<script lang="ts">
import type { McpScope } from "@nervekit/contracts/mcp";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import FormDialog from "@nervekit/ui-kit/components/composites/form-dialog";
import RadioGroupField from "@nervekit/ui-kit/components/composites/radio-group-field";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { mcpTarget, saveMcpServer } from "$lib/application/mcp/mcp-api";
import SettingsFormField from "../../shared/settings-form-field.svelte";
import McpServerForm from "./McpServerForm.svelte";
import {
  emptyMcpForm,
  entryFromForm,
  entryJson,
  formFromEntry,
  validateMcpForm,
  withSecretValues,
  type McpFormValues,
} from "./mcp-form";
import { parseMcpPaste } from "./mcp-paste";

type Props = {
  open?: boolean;
  /** The open project, offered as a level. */
  project?: { id: string; name: string };
  /** Called with the new server's name and level. */
  onSaved: (name: string, scope: McpScope) => void;
};
let { open = $bindable(false), project, onSaved }: Props = $props();

let form = $state<McpFormValues>(emptyMcpForm());
let mode = $state<"form" | "json">("form");
let jsonText = $state("");
let level = $state("user");
let busy = $state(false);
let error = $state<string>();
let notice = $state<string>();
let fileProblems = $state<string[]>();
/** Secret values typed in the form, kept while the JSON view is shown. */
let typedSecrets = $state<Record<string, string>>({});
let lastOpen = false;

$effect(() => {
  if (open && !lastOpen) {
    form = emptyMcpForm();
    mode = "form";
    jsonText = "";
    level = "user";
    error = notice = fileProblems = undefined;
    typedSecrets = {};
  }
  lastOpen = open;
});

function showJson() {
  const submission = entryFromForm(form);
  typedSecrets = submission.secrets;
  const hasContent = form.command.trim() || form.url.trim();
  jsonText = hasContent ? entryJson(submission.entry) : "";
  notice = undefined;
  mode = "json";
}

/** Reads the JSON into the form; false (with `error` set) when it cannot be read. */
function applyJson(): boolean {
  const parsed = parseMcpPaste(jsonText);
  if (!parsed.ok) {
    error = parsed.message;
    return false;
  }
  const [first, ...more] = parsed.servers;
  const name = first!.name ?? form.name;
  form = withSecretValues(formFromEntry(name, first!.entry), typedSecrets);
  const notes = [
    more.length
      ? `Found ${more.length + 1} servers; filled in ${name}. Add the others one by one.`
      : undefined,
    parsed.ignored.length
      ? `Not used by Nerve: ${parsed.ignored.join(", ")}.`
      : undefined,
  ].filter(Boolean);
  notice = notes.join(" ") || undefined;
  error = undefined;
  return true;
}

function showForm() {
  if (applyJson()) mode = "form";
}

async function save(replaceInvalid = false) {
  if (mode === "json" && !applyJson()) return;
  const problem = validateMcpForm(form);
  if (problem) {
    error = problem;
    return;
  }
  const submission = entryFromForm(form);
  const scope: McpScope = level === "project" && project ? "project" : "user";
  busy = true;
  error = undefined;
  try {
    const result = await saveMcpServer({
      target: mcpTarget(scope, project?.id),
      name: submission.name,
      entry: submission.entry,
      ...(Object.keys(submission.secrets).length
        ? { secrets: submission.secrets }
        : {}),
      ...(replaceInvalid ? { replaceInvalid: true } : {}),
    });
    if (result.status === "saved") {
      open = false;
      onSaved(submission.name, scope);
    } else if (result.status === "invalid") {
      fileProblems = undefined;
      error = result.problems.join(" ");
    } else {
      fileProblems = result.problems;
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy = false;
  }
}

const JSON_PLACEHOLDER =
  '{ "mcpServers": { "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] } } }';

const levels = $derived([
  { value: "user", label: "User", detail: "Available in every project" },
  ...(project
    ? [
        {
          value: "project",
          label: "This project",
          detail: "Stored in the project and shared through the repository",
        },
      ]
    : []),
]);
</script>

<FormDialog
  bind:open
  size="md"
  title="Add MCP server"
  description="Secret values are stored on this computer, never in the file."
  submitLabel="Save"
  {busy}
  {error}
  onSubmit={() => save()}
>
  {#if project}
    <RadioGroupField
      items={levels}
      bind:value={level}
      ariaLabel="Available to"
    />
  {/if}
  <SettingsFormField id="mcp-name" label="Name">
    <Input id="mcp-name" placeholder="github" bind:value={form.name} />
  </SettingsFormField>

  <ToggleGroup.Root
    type="single"
    variant="outline"
    size="sm"
    value={mode}
    aria-label="Editing mode"
    onValueChange={(value) => {
      if (value === "json" && mode !== "json") showJson();
      else if (value === "form" && mode !== "form") showForm();
    }}
  >
    <ToggleGroup.Item value="form">Form</ToggleGroup.Item>
    <ToggleGroup.Item value="json">Paste JSON</ToggleGroup.Item>
  </ToggleGroup.Root>

  {#if notice}<Callout tone="info" text={notice} />{/if}
  {#if mode === "form"}
    <McpServerForm bind:form />
  {:else}
    <Textarea
      class="font-mono"
      rows={10}
      spellcheck={false}
      aria-label="Server JSON"
      placeholder={JSON_PLACEHOLDER}
      bind:value={jsonText}
    />
  {/if}

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
          disabled={busy}
          onclick={() => save(true)}>Replace with a valid file</Button
        >
      {/snippet}
    </Callout>
  {/if}
</FormDialog>
