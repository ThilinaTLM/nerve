<script lang="ts">
import { trimTextPreview } from "@nervekit/ui-kit/core/utils/text-preview";
import ToolStatusIcon from "./ToolStatusIcon.svelte";

type Props = {
  toolName: string;
  error: string;
};

let { toolName, error }: Props = $props();

const errorPreview = $derived(
  trimTextPreview(error, { headLines: 18, tailLines: 6, maxChars: 6_000 }).text,
);
</script>

<article class="tool-result-error-card">
  <div class="tool-header">
    <ToolStatusIcon tone="danger" size={14} class="mr-1.5 align-middle" />
    <span class="badge">{toolName}</span>
  </div>
  <pre class="tool-error">{errorPreview}</pre>
</article>

<style>
.tool-result-error-card {
  display: grid;
  gap: 0.4rem;
  width: 100%;
  padding: 0.6rem 0;
}

.tool-header {
  min-width: 0;
  line-height: 1.5;
}

.badge {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 650;
  color: var(--foreground);
}

.tool-error {
  margin: 0;
  border: 1px solid color-mix(in oklab, var(--destructive) 40%, var(--border));
  border-radius: var(--radius-sm);
  background: var(--sidebar);
  color: var(--destructive);
  padding: 0.48rem 0.58rem;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
