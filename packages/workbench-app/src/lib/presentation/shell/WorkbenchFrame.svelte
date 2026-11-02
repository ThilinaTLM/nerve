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
  /* Insets are 0 on desktop; a landscape phone lands here (compact tier)
   * with side notches and a home indicator. */
  grid-template-rows:
    calc(3rem + var(--safe-top))
    minmax(0, 1fr)
    calc(1.75rem + var(--safe-bottom));
  padding-inline: var(--safe-left) var(--safe-right);
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
      calc(3rem + var(--safe-top))
      minmax(0, 1fr)
      calc(2.5rem + var(--safe-bottom));
  }
}
</style>
