<script lang="ts">
import { ansiToHtml } from "@nervekit/ui-kit/terminal/ansi";
import type { LaunchLogEvent } from "@nervekit/contracts/launches";

type Props = {
  text: string;
  stream?: LaunchLogEvent["stream"];
  level?: LaunchLogEvent["level"];
};

let { text, stream, level }: Props = $props();
const html = $derived(ansiToHtml(text, { linkifyUrls: true }));
</script>

<span
  class="terminal-text terminal-output"
  data-stream={stream}
  data-level={level}
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- ansiToHtml escapes terminal text and emits only controlled ANSI spans and HTTP(S) links. -->
  {@html html}
</span>

<style>
.terminal-text {
  display: inline;
}
</style>
