import type { ConfigurationReviewTarget } from "@nervekit/contracts/configuration";
import { untrack } from "svelte";
import { ConfigurationItemReview } from "$lib/application/configuration-review/configuration-item-review.svelte";

/**
 * The review of `target()` for a page component, recreated when the target
 * changes and following decisions made in the dialog. Call during component
 * initialisation.
 */
export function useItemReview(
  target: () => ConfigurationReviewTarget | undefined,
): { readonly current: ConfigurationItemReview | undefined } {
  const key = $derived.by(() => {
    const value = target();
    return value
      ? JSON.stringify([value.kind, value.scope, value.projectId, value.id])
      : "";
  });
  const review = $derived.by(() => {
    if (!key) return undefined;
    const value = untrack(target);
    return value ? new ConfigurationItemReview(value) : undefined;
  });
  $effect(() => review?.start());
  return {
    get current() {
      return review;
    },
  };
}
