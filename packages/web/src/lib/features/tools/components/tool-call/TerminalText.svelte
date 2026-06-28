<script lang="ts">
  import { ansiToHtml } from "$lib/core/terminal/ansi";
  import type { TaskLogEvent } from "$lib/api";

  type Props = {
    text: string;
    stream?: TaskLogEvent["stream"];
    level?: TaskLogEvent["level"];
  };

  let { text, stream, level }: Props = $props();
  const html = $derived(ansiToHtml(text));
</script>

<span class="terminal-text terminal-output" data-stream={stream} data-level={level}>{@html html}</span>

<style>
  .terminal-text {
    display: inline;
  }
</style>
