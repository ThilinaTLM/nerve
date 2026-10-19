import type { Activity } from "@nervekit/contracts/activity";

/** Retired session-local notice ids must not accumulate or be revived by late view callbacks. */
export function updateActivityReadIds(
  current: Set<string>,
  activities: readonly Activity[],
  viewed: readonly string[] = [],
): Set<string> {
  const retained = new Set(activities.map((activity) => activity.id));
  const keep = (id: string) =>
    !id.startsWith("client-notice:") || retained.has(id);
  const next = new Set([...current, ...viewed].filter(keep));
  if (next.size === current.size && [...next].every((id) => current.has(id)))
    return current;
  return next;
}
