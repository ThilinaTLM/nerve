<script lang="ts">
type Props = { text: string };
let { text }: Props = $props();
</script>

<!-- Errors are always the last section of the sheet. -->
<div class="bg-destructive/5 px-2.5 py-2">
  <pre
    class="m-0 font-mono text-xs leading-snug whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">{text}</pre>
</div>
