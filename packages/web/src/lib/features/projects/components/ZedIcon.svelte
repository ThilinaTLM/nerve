<script lang="ts">
  import zedLogo from "$lib/assets/zed-logo.svg?raw";

  const icon = zedLogo.replace("<svg ", '<svg class="size-3.5" ');
</script>

{@html icon}
