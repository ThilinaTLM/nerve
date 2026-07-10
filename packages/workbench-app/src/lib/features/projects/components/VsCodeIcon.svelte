<script lang="ts">
import vscodeLogo from "$lib/assets/vscode-logo.svg?raw";

const icon = vscodeLogo.replace("<svg ", '<svg class="size-3.5" ');
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- Bundled local SVG asset; no user or API content is rendered. -->
{@html icon}
