<script lang="ts">
import zedLogo from "$lib/assets/zed-logo.svg?raw";

const icon = zedLogo.replace("<svg ", '<svg class="size-3.5" ');
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- Bundled local SVG asset; no user or API content is rendered. -->
{@html icon}
