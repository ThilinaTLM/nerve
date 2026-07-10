<script lang="ts">
import { ansiToHtml } from "@nervekit/ui-kit/core/terminal/ansi";
import type { TaskLogEvent } from "../../../state/tool-types";

type Props = {
  text: string;
  stream?: TaskLogEvent["stream"];
  level?: TaskLogEvent["level"];
};

let { text, stream, level }: Props = $props();
const html = $derived(ansiToHtml(text));
</script>

<span
  class="terminal-text terminal-output"
  data-stream={stream}
  data-level={level}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- ansiToHtml escapes terminal text and emits only controlled ANSI spans. -->
  {@html html}
</span>

<style>
.terminal-text {
  display: inline;
}
</style>
