<script lang="ts">
// Renders its children outside any enclosing CardSheet, so an embedded card
// preview draws its own sheet instead of joining the surrounding one.
import type { Snippet } from "svelte";
import { leaveCardSheet } from "./sheet-context";

let { children }: { children: Snippet } = $props();

leaveCardSheet();
</script>

{@render children()}
