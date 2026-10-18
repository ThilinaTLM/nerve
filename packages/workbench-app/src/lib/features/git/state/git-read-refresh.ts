import type { QueryClient, QueryKey } from "@tanstack/query-core";

/** Deliver a stale result, then at most one demanded soft revalidation. No timer
 * or recursive retry: still-stale/error follow-ups wait for new external demand.
 */
export async function refreshGitRead<T extends { stale?: boolean }>(options: {
  client: QueryClient;
  queryKey: QueryKey;
  staleTime: number;
  invalidate?: "hard" | "soft";
  read(followup: boolean): Promise<T>;
  publish(value: T): void;
  isCurrent(): boolean;
  hasDemand(): boolean;
  isStale?(value: T): boolean;
  canFollowup?(): boolean;
  onFollowup?(): void;
}): Promise<T | undefined> {
  const invalidate = (soft: boolean) =>
    options.client.invalidateQueries(
      { queryKey: options.queryKey, exact: true, refetchType: "none" },
      { cancelRefetch: !soft },
    );
  const read = (followup: boolean) =>
    options.client.fetchQuery({
      queryKey: options.queryKey,
      queryFn: () => options.read(followup),
      staleTime: options.staleTime,
      // A failed follow-up is terminal for this demand, including query retries.
      ...(followup ? { retry: false } : {}),
    });
  if (options.invalidate) await invalidate(options.invalidate === "soft");
  const first = await read(false);
  if (!options.isCurrent()) return;
  options.publish(first);
  if (
    !(options.isStale?.(first) ?? first.stale) ||
    !options.hasDemand() ||
    options.canFollowup?.() === false
  )
    return first;
  options.onFollowup?.();
  await invalidate(true);
  if (!options.isCurrent() || !options.hasDemand()) return first;
  const next = await read(true);
  if (!options.isCurrent()) return;
  options.publish(next);
  return next;
}
