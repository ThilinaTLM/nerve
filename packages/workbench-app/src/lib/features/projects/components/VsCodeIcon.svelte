<script lang="ts">
  import vscodeLogo from "$lib/assets/vscode-logo.svg?raw";

  const icon = vscodeLogo.replace("<svg ", '<svg class="size-3.5" ');
</script>

{@html icon}
