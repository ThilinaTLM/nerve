<!-- The fields of one MCP server entry: stdio (command, arguments, environment) or HTTP (URL, headers). -->
<script lang="ts">
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
import SettingsFormField from "../../shared/settings-form-field.svelte";
import McpKeyValueEditor from "./McpKeyValueEditor.svelte";
import type { McpFormValues } from "./mcp-form";

let { form = $bindable() }: { form: McpFormValues } = $props();
const argsPlaceholder = "-y\n@modelcontextprotocol/server-github";
</script>

<ToggleGroup.Root
  type="single"
  variant="outline"
  size="sm"
  value={form.transport}
  aria-label="Transport"
  onValueChange={(value) => {
    if (value === "stdio" || value === "http") form.transport = value;
  }}
>
  <ToggleGroup.Item value="stdio">Local command</ToggleGroup.Item>
  <ToggleGroup.Item value="http">HTTP URL</ToggleGroup.Item>
</ToggleGroup.Root>

{#if form.transport === "stdio"}
  <SettingsFormField id="mcp-command" label="Command">
    <Input
      id="mcp-command"
      class="font-mono"
      placeholder="npx"
      bind:value={form.command}
    />
  </SettingsFormField>
  <SettingsFormField id="mcp-args" label="Arguments, one per line">
    <Textarea
      id="mcp-args"
      class="font-mono"
      rows={2}
      placeholder={argsPlaceholder}
      bind:value={form.args}
    />
  </SettingsFormField>
  <SettingsFormField id="mcp-cwd" label="Working directory (optional)">
    <Input id="mcp-cwd" class="font-mono" bind:value={form.cwd} />
  </SettingsFormField>
  <SettingsFormField label="Environment variables">
    <McpKeyValueEditor
      bind:rows={form.env}
      noun="variable"
      keyPlaceholder="GITHUB_TOKEN"
    />
  </SettingsFormField>
{:else}
  <SettingsFormField id="mcp-url" label="URL">
    <Input
      id="mcp-url"
      class="font-mono"
      placeholder="https://example.com/mcp"
      bind:value={form.url}
    />
  </SettingsFormField>
  <SettingsFormField label="Headers">
    <McpKeyValueEditor
      bind:rows={form.headers}
      noun="header"
      keyPlaceholder="Authorization"
    />
  </SettingsFormField>
{/if}
<SettingsFormField id="mcp-description" label="Description (optional)">
  <Input id="mcp-description" bind:value={form.description} />
</SettingsFormField>
<SettingsFormField
  id="mcp-timeout"
  label="Request timeout in seconds (optional)"
>
  <Input
    id="mcp-timeout"
    class="w-32"
    inputmode="numeric"
    bind:value={form.timeout}
  />
</SettingsFormField>
