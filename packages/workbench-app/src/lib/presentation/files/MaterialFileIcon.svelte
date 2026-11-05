<script lang="ts">
import { onMount } from "svelte";
import {
  ensureMaterialFileIconSprite,
  materialFileIcon,
} from "./material-file-icons";

let {
  name,
  kind,
  open = false,
}: {
  name: string;
  kind: "file" | "directory" | "other";
  open?: boolean;
} = $props();

let ready = $state(false);
const src = $derived(materialFileIcon({ name, kind, open }));

onMount(() => {
  void ensureMaterialFileIconSprite()
    .then(() => (ready = true))
    .catch(() => undefined);
});
</script>

{#if ready && src}
  <svg class="size-4 shrink-0" aria-hidden="true">
    <use href={src}></use>
  </svg>
{/if}
