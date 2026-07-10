import {
  type StorageCleanupOperation,
  type StorageCleanupRequest,
  type StorageCleanupTarget,
  type StorageCleanupTargetUsage,
  storageCleanupUpdatedEventSchema,
} from "@nervekit/contracts";

export interface StorageCleanupSelection {
  conversations: boolean;
  conversationsDays: number;
  datedLogs: boolean;
  logsDays: number;
  rotatedEventLog: boolean;
  toolCallLog: boolean;
  exploreReports: boolean;
  cache: boolean;
  tmp: boolean;
  searchIndex: boolean;
}

export const EMPTY_CLEANUP_SELECTION: StorageCleanupSelection = {
  conversations: false,
  conversationsDays: 30,
  datedLogs: false,
  logsDays: 14,
  rotatedEventLog: false,
  toolCallLog: false,
  exploreReports: false,
  cache: false,
  tmp: false,
  searchIndex: false,
};

export function recommendedCleanupSelection(): StorageCleanupSelection {
  return {
    ...EMPTY_CLEANUP_SELECTION,
    datedLogs: true,
    rotatedEventLog: true,
    toolCallLog: true,
    exploreReports: true,
    cache: true,
    tmp: true,
  };
}

export function allCleanupSelection(
  current: StorageCleanupSelection,
): StorageCleanupSelection {
  return {
    conversations: true,
    conversationsDays: validDays(current.conversationsDays) ?? 30,
    datedLogs: true,
    logsDays: validDays(current.logsDays) ?? 14,
    rotatedEventLog: true,
    toolCallLog: true,
    exploreReports: true,
    cache: true,
    tmp: true,
    searchIndex: true,
  };
}

export function validDays(value: number): number | undefined {
  return Number.isInteger(value) && value >= 1 && value <= 3650
    ? value
    : undefined;
}

export function cleanupSelectionError(
  selection: StorageCleanupSelection,
): string | undefined {
  if (
    selection.conversations &&
    validDays(selection.conversationsDays) === undefined
  )
    return "Conversation age must be a whole number from 1 to 3650.";
  if (selection.datedLogs && validDays(selection.logsDays) === undefined)
    return "Log age must be a whole number from 1 to 3650.";
  return undefined;
}

export function buildCleanupRequest(
  selection: StorageCleanupSelection,
): StorageCleanupRequest | undefined {
  if (cleanupSelectionError(selection)) return undefined;
  const request: StorageCleanupRequest = {};
  if (selection.conversations)
    request.conversationsOlderThanDays = validDays(selection.conversationsDays);
  if (selection.datedLogs)
    request.logsOlderThanDays = validDays(selection.logsDays);
  if (selection.rotatedEventLog) request.truncateEventLog = true;
  if (selection.toolCallLog) request.clearToolCallLog = true;
  if (selection.exploreReports) request.clearExploreReports = true;
  if (selection.cache) request.clearCache = true;
  if (selection.tmp) request.clearTmp = true;
  if (selection.searchIndex) request.rebuildSearchIndex = true;
  return Object.keys(request).length > 0 ? request : undefined;
}

export function selectedTargets(
  selection: StorageCleanupSelection,
): StorageCleanupTarget[] {
  const targets: StorageCleanupTarget[] = [];
  if (selection.conversations) targets.push("conversations");
  if (selection.datedLogs) targets.push("datedLogs");
  if (selection.rotatedEventLog) targets.push("rotatedEventLog");
  if (selection.toolCallLog) targets.push("toolCallLog");
  if (selection.exploreReports) targets.push("exploreReports");
  if (selection.cache) targets.push("cache");
  if (selection.tmp) targets.push("tmp");
  if (selection.searchIndex) targets.push("searchIndex");
  return targets;
}

export function selectedFootprint(
  selection: StorageCleanupSelection,
  usage: StorageCleanupTargetUsage[],
): { bytes: number; upTo: boolean } {
  const selected = new Set(selectedTargets(selection));
  let bytes = 0;
  let upTo = false;
  for (const target of usage) {
    if (!selected.has(target.target)) continue;
    bytes += target.bytes;
    if (target.estimate !== "exact") upTo = true;
  }
  return { bytes, upTo };
}

export function cleanupProgress(operation: StorageCleanupOperation): number {
  if (operation.totalTargets <= 0)
    return operation.status === "succeeded" ? 100 : 0;
  return Math.min(
    100,
    Math.round((operation.completedTargets / operation.totalTargets) * 100),
  );
}

export function isCleanupActive(
  operation?: StorageCleanupOperation | null,
): boolean {
  return (
    !!operation &&
    ["queued", "running", "cancelling"].includes(operation.status)
  );
}

export function parseStorageCleanupEvent(
  data: unknown,
): StorageCleanupOperation | undefined {
  const parsed = storageCleanupUpdatedEventSchema.safeParse(data);
  return parsed.success ? parsed.data.operation : undefined;
}

export function targetLabel(target: StorageCleanupTarget): string {
  return (
    {
      conversations: "Old conversations",
      datedLogs: "Dated logs",
      rotatedEventLog: "Rotated event log",
      toolCallLog: "Tool-call log",
      exploreReports: "Explore reports",
      cache: "Cache",
      tmp: "Temporary files",
      searchIndex: "Search index",
    } satisfies Record<StorageCleanupTarget, string>
  )[target];
}
