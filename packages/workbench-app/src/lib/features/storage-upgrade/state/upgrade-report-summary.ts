import type {
  UpgradeReport,
  UpgradeReportLoss,
  UpgradeReportSetAside,
} from "@nervekit/contracts/status";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function upgradeReportSetAside(
  reports: readonly UpgradeReport[],
): UpgradeReportSetAside[] {
  return reports.flatMap((report) => report.setAside);
}

/** Losses with the same reason are merged across reports. */
export function upgradeReportLosses(
  reports: readonly UpgradeReport[],
): UpgradeReportLoss[] {
  const byReason = new Map<string, number>();
  for (const loss of reports.flatMap((report) => report.losses)) {
    byReason.set(loss.reason, (byReason.get(loss.reason) ?? 0) + loss.count);
  }
  return [...byReason].map(([reason, count]) => ({ reason, count }));
}

export function summarizeUpgradeReports(
  reports: readonly UpgradeReport[],
): string {
  const setAside = upgradeReportSetAside(reports);
  const conversations = setAside.filter(
    (item) => item.kind === "conversation",
  ).length;
  const settings = setAside.length - conversations;
  const parts: string[] = [];
  if (conversations > 0) {
    parts.push(plural(conversations, "conversation", "conversations"));
  }
  if (settings > 0) {
    parts.push(plural(settings, "settings file", "settings files"));
  }
  const lossCount = upgradeReportLosses(reports).reduce(
    (total, loss) => total + loss.count,
    0,
  );
  const lead = "Upgrade complete: ";
  if (parts.length === 0) {
    return lossCount > 0
      ? `${lead}${plural(lossCount, "item", "items")} could not be fully upgraded.`
      : `${lead}nothing needed attention.`;
  }
  const total = conversations + settings;
  const subject = parts.join(" and ");
  const verb = total === 1 ? "was" : "were";
  return `${lead}${subject} ${verb} set aside because ${total === 1 ? "it" : "they"} couldn't be upgraded.`;
}

/** Compact two-line form for the activity list. */
export function upgradeReportHeadline(reports: readonly UpgradeReport[]): {
  title: string;
  description: string;
} {
  const setAside = upgradeReportSetAside(reports);
  const conversations = setAside.filter(
    (item) => item.kind === "conversation",
  ).length;
  const settings = setAside.length - conversations;
  const lossCount = upgradeReportLosses(reports).reduce(
    (total, loss) => total + loss.count,
    0,
  );
  const parts: string[] = [];
  if (conversations > 0)
    parts.push(plural(conversations, "conversation", "conversations"));
  if (settings > 0)
    parts.push(plural(settings, "settings file", "settings files"));
  if (parts.length > 0)
    return {
      title: "Upgrade finished with issues",
      description: `${parts.join(" and ")} couldn't be upgraded`,
    };
  if (lossCount > 0)
    return {
      title: "Upgrade finished with issues",
      description: `${plural(lossCount, "item", "items")} not fully upgraded`,
    };
  return { title: "Upgrade finished", description: "Nothing needed attention" };
}

/** Keep the activity details bounded even when many units share one failure. */
export function upgradeReportSetAsideGroups(reports: readonly UpgradeReport[]) {
  const groups = new Map<
    string,
    {
      kind: UpgradeReportSetAside["kind"];
      reason: string;
      count: number;
      paths: string[];
    }
  >();
  for (const item of upgradeReportSetAside(reports)) {
    const reason = item.reason
      .replace(/(?<![\w])(?:[A-Za-z]:[\\/]|\/)[^\s:;,]+:?\s*/g, "")
      .trim();
    const key = `${item.kind}\u0000${reason}`;
    const group = groups.get(key) ?? {
      kind: item.kind,
      reason,
      count: 0,
      paths: [],
    };
    group.count++;
    if (group.paths.length < 3) group.paths.push(item.quarantinePath);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Plain-language row label, e.g. "159 settings files couldn't be read". */
export function setAsideGroupLabel(group: {
  kind: UpgradeReportSetAside["kind"];
  count: number;
}): string {
  const subject =
    group.kind === "conversation"
      ? plural(group.count, "conversation", "conversations")
      : plural(group.count, "settings file", "settings files");
  return `${subject} couldn't be read`;
}

/** Shows a path relative to the Nerve home when it lives under it. */
export function homeRelativePath(path: string, home: string | undefined) {
  if (home && path.startsWith(`${home}/`)) return path.slice(home.length + 1);
  return path;
}
