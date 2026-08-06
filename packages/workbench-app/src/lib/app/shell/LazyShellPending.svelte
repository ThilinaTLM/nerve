<script lang="ts">
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
</script>

<div class="lazy-shell-pending" aria-busy="true">
  <Spinner class="size-5" />
</div>

<style>
.lazy-shell-pending {
  display: grid;
  height: 100%;
  min-height: 6rem;
  place-items: center;
  color: var(--muted-foreground);
}
</style>
