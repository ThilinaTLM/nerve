<script lang="ts">
import type { Snippet } from "svelte";

let {
  titlebar,
  workspace,
  footer,
}: {
  titlebar: Snippet;
  workspace: Snippet;
  footer: Snippet;
} = $props();
</script>

<main class="app-frame">
  {@render titlebar()}
  {@render workspace()}
  {@render footer()}
</main>

<style>
/* Safe-area insets and dvh fallbacks keep the frame stable on mobile, so the
 * row track math stays in CSS. */
.app-frame {
  position: relative;
  display: grid;
  width: 100%;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 3rem minmax(0, 1fr) 1.75rem;
  overflow: hidden;
  background: var(--background);
  color: var(--foreground);
}

@supports (height: 100dvh) {
  .app-frame {
    height: 100dvh;
  }
}

@media (max-width: 639px) {
  .app-frame {
    grid-template-rows:
      calc(3rem + env(safe-area-inset-top))
      minmax(0, 1fr)
      calc(2.5rem + env(safe-area-inset-bottom));
  }
}
</style>
