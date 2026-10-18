import type { Activity } from "@nervekit/contracts/activity";

/** Failures arriving while Activity is open are already visible, not unread. */
export class ActivityAttention {
  #seen = new Set<string>();
  update(activities: Activity[], open: boolean): boolean {
    const failures = activities.filter(
      (entry) => entry.status === "failed" || entry.status === "interrupted",
    );
    const ids = new Set(failures.map((entry) => entry.id));
    for (const id of this.#seen) if (!ids.has(id)) this.#seen.delete(id);
    if (open) for (const id of ids) this.#seen.add(id);
    return failures.some((entry) => !this.#seen.has(entry.id));
  }
}
