/**
 * Projects tab grouping: projects with something moving or waiting float into
 * an "Active" section with a count line; everything else is "Recent".
 */

type ActivityLike = { indicator: string };

export type MobileProjectCounts = {
  running: number;
  needsYou: number;
  background: number;
};

export type MobileProjectEntry<T> = { item: T; counts: MobileProjectCounts };

export type MobileProjectGroups<T> = {
  active: MobileProjectEntry<T>[];
  recent: T[];
};

/** Counts conversations by what they ask of the reader. */
export function projectCounts(
  projectIds: readonly string[],
  conversations: readonly { id: string; projectId: string }[],
  activityById: Readonly<Record<string, ActivityLike | undefined>>,
): MobileProjectCounts {
  const counts: MobileProjectCounts = {
    running: 0,
    needsYou: 0,
    background: 0,
  };
  for (const conversation of conversations) {
    if (!projectIds.includes(conversation.projectId)) continue;
    switch (activityById[conversation.id]?.indicator) {
      case "running":
        counts.running += 1;
        break;
      case "needs-user":
      case "error":
        counts.needsYou += 1;
        break;
      case "awaiting-async":
        counts.background += 1;
        break;
      default:
    }
  }
  return counts;
}

export function projectIsActive(counts: MobileProjectCounts): boolean {
  return counts.running + counts.needsYou + counts.background > 0;
}

/** "1 running · 1 needs you · 2 in background" */
export function projectCountsLine(counts: MobileProjectCounts): string {
  const parts: string[] = [];
  if (counts.running) parts.push(`${counts.running} running`);
  if (counts.needsYou) parts.push(`${counts.needsYou} needs you`);
  if (counts.background) parts.push(`${counts.background} in background`);
  return parts.join(" · ");
}

export function groupMobileProjects<
  T extends { projectIds: readonly string[] },
>(
  items: readonly T[],
  conversations: readonly { id: string; projectId: string }[],
  activityById: Readonly<Record<string, ActivityLike | undefined>>,
): MobileProjectGroups<T> {
  const active: MobileProjectEntry<T>[] = [];
  const recent: T[] = [];
  for (const item of items) {
    const counts = projectCounts(item.projectIds, conversations, activityById);
    if (projectIsActive(counts)) active.push({ item, counts });
    else recent.push(item);
  }
  // Waiting-on-you projects lead; ties keep the switcher's recency order.
  active.sort(
    (left, right) =>
      Number(right.counts.needsYou > 0) - Number(left.counts.needsYou > 0),
  );
  return { active, recent };
}
