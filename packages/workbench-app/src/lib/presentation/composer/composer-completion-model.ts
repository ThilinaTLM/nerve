// Pure view-model for the composer suggestion popup: grouping, ordering,
// row state and the status bar. No CodeMirror or Svelte imports so it can be
// unit-tested directly and rendered by any host.
import type {
  CompletionGroup,
  CompletionItem,
  CompletionKind,
  CompletionSearchResponse,
  CompletionSourceState,
} from "@nervekit/contracts/completions";

export type ComposerReferenceSource = {
  search(
    query: string,
    options?: { limit?: number },
  ): Promise<ComposerSearchResponse>;
  select(
    item: CompletionItem,
    action: "select" | "disable",
  ): Promise<CompletionItem>;
  subscribe(listener: () => void): () => void;
};

/** A fix-it the popup offers (status bar button); the host decides what it does. */
export type ComposerCompletionAction =
  | {
      type: "source";
      source: ComposerSourceState;
      actionId: "open_pull_requests" | "open_settings";
    }
  | { type: "item"; item: CompletionItem };

/** Categories a mention can be narrowed to (`@pr:` etc.). */
export const COMPLETION_SCOPES = [
  { id: "file", prefix: "file:", label: "Files" },
  { id: "pr", prefix: "pr:", label: "Pull requests" },
  { id: "issue", prefix: "issue:", label: "Issues" },
  { id: "skill", prefix: "skill:", label: "Skills" },
  { id: "tool", prefix: "tool:", label: "Tools" },
  { id: "agent", prefix: "agent:", label: "Agents" },
  { id: "launch", prefix: "launch:", label: "Launches" },
] as const;
export type CompletionScopeId = (typeof COMPLETION_SCOPES)[number]["id"];

export const UNSCOPED_GROUP_LIMIT = 3;
export const SCOPED_ROW_LIMIT = 12;
/** Rows asked for a bare "@" (Recent) and for unscoped searches. */
export const RECENT_REQUEST_LIMIT = 8;
export const RECENT_GROUP_ID = "recent";

const scopeById = new Map<string, (typeof COMPLETION_SCOPES)[number]>(
  COMPLETION_SCOPES.map((scope) => [scope.id, scope]),
);
export const completionScope = (id: string | undefined) =>
  id ? scopeById.get(id) : undefined;

const scopeAliases: Readonly<Record<string, CompletionScopeId>> = {
  profile: "agent",
};

/** Leading `scope:` of a mention query (without the `@`). */
export function parseMentionScope(raw: string): {
  scope?: CompletionScopeId;
  query: string;
} {
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const key = raw.slice(0, colon).toLowerCase();
    const id = scopeAliases[key] ?? (scopeById.has(key) ? key : undefined);
    if (id)
      return { scope: id as CompletionScopeId, query: raw.slice(colon + 1) };
  }
  return { query: raw };
}

export function scopeOfKind(
  kind: CompletionKind,
): CompletionScopeId | undefined {
  switch (kind) {
    case "file":
    case "directory":
      return "file";
    case "pull_request":
      return "pr";
    case "issue":
      return "issue";
    case "skill":
      return "skill";
    case "tool":
      return "tool";
    case "subagent":
    case "subagent_profile":
      return "agent";
    case "launch":
    case "launch_definition":
      return "launch";
    default:
      return undefined;
  }
}

/** Optional fields the backend may attach; everything degrades when absent. */
export type BadgeTone =
  | "neutral"
  | "success"
  | "info"
  | "warning"
  | "destructive"
  | "outline";
export type ComposerSourceState = CompletionSourceState;
export type ComposerSearchResponse = Pick<
  CompletionSearchResponse,
  "items" | "sources" | "groups"
>;

const GROUP_SCOPE: Readonly<Record<CompletionGroup, CompletionScopeId>> = {
  files: "file",
  pull_requests: "pr",
  issues: "issue",
  skills: "skill",
  tools: "tool",
  agents: "agent",
  launches: "launch",
};
export const SOURCE_ACTION_LABELS = {
  open_pull_requests: "Open pull requests",
  open_settings: "Settings",
} as const;

export type PopupRow = {
  id: string;
  item: CompletionItem;
  kind: CompletionKind;
  groupId: string;
  /** Display name (files: base name). */
  name: string;
  /** Files: parent directory; otherwise unused. */
  dir?: string;
  meta?: string;
  state: "ready" | "off" | "unavailable";
  badge?: { text: string; variant: BadgeTone };
  /** Slash: this is the active mode. */
  current?: boolean;
  /** Skills/tools/agent profiles can be turned on/off in place. */
  toggleable: boolean;
  reason?: string;
  /** Exact text written into the prompt on accept. */
  insert: string;
  /** Chip label after insertion. */
  chipLabel: string;
  /** Slash command name (no "/"). */
  command?: string;
  mono: boolean;
};

export type PopupGroup = {
  id: string;
  label: string;
  rows: PopupRow[];
  more?: number;
  /** Scope a "+N more" click narrows to. */
  scope?: CompletionScopeId;
  loading?: boolean;
};

export type PopupFooter = {
  tone: "muted" | "info" | "warning" | "destructive";
  icon?: "spinner" | "info" | "warning" | "offline" | "error";
  text: string;
  action?: { label: string; id: string };
};

export type PopupModel = {
  mode: "mention" | "slash";
  placement: "above" | "below";
  /** Groups in relevance order (best first); the view reverses when above. */
  groups: PopupGroup[];
  selectedId?: string;
  scope?: { id: CompletionScopeId; label: string };
  query: string;
  /** Bare "@": show the "Narrow: pr: skill: …" hint. */
  showScopeHint: boolean;
  footer?: PopupFooter;
  /** Label for the Enter hint. */
  primary: string;
  pendingId?: string;
  empty?: string;
  /** Row action label for the selected row, if it can be toggled. */
  toggleLabel?: "Turn on" | "Turn off";
};

const SLASH_GROUPS: Readonly<Record<string, string>> = {
  plan: "Mode",
  code: "Mode",
  compact: "Conversation",
  new: "Conversation",
  abort: "Run",
};
const SLASH_GROUP_ORDER = ["Mode", "Conversation", "Run", "Commands"];

export function stripMentionPrefix(label: string): string {
  return label.replace(/^@/, "").replace(/^[a-z]+:/i, "");
}

const TOGGLEABLE_KINDS: ReadonlySet<CompletionKind> = new Set([
  "skill",
  "tool",
  "subagent_profile",
]);

/** Raw lowercase `status` from the server → badge tone (text is title-cased). */
const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  open: "success",
  merged: "info",
  draft: "neutral",
  closed: "outline",
  running: "success",
  exited: "outline",
  failed: "destructive",
  queued: "neutral",
  waiting: "neutral",
  stopping: "warning",
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function rowState(item: CompletionItem): PopupRow["state"] {
  if (item.available === false) return "unavailable";
  if (item.enabled === false) return "off";
  return "ready";
}

export function isToggleable(item: CompletionItem): boolean {
  if (!item.documentId || !item.version) return false;
  if (!TOGGLEABLE_KINDS.has(item.kind)) return false;
  if (item.available === false) return false;
  return item.enabled === false || item.canDisable === true;
}

export function toPopupRow(item: CompletionItem): PopupRow {
  const state = rowState(item);
  const insert = item.apply ?? item.label;
  const isPath = item.kind === "file" || item.kind === "directory";
  let name: string;
  let dir: string | undefined;
  if (isPath) {
    const rel = (item.info ?? stripMentionPrefix(item.label)).replace(/^@/, "");
    const isDir = item.kind === "directory";
    const base = isDir ? rel.replace(/\/+$/, "") : rel;
    const cut = base.lastIndexOf("/") + 1;
    name = base.slice(cut) + (isDir ? "/" : "");
    dir = base.slice(0, cut) || undefined;
  } else {
    name = item.displayLabel ?? stripMentionPrefix(item.label);
  }
  let badge: PopupRow["badge"];
  if (state === "unavailable")
    badge = { text: "Unavailable", variant: "outline" };
  else if (state === "off") badge = { text: "Off", variant: "outline" };
  else if (item.status)
    badge = {
      text: titleCase(item.status),
      variant: STATUS_TONES[item.status.toLowerCase()] ?? "neutral",
    };
  const scope = scopeOfKind(item.kind);
  return {
    id: item.documentId ?? `${item.kind}:${item.label}`,
    item,
    kind: item.kind,
    groupId: scope ?? "other",
    name,
    dir,
    meta: isPath ? undefined : item.detail,
    state,
    badge,
    toggleable: isToggleable(item),
    reason: item.unavailableReason,
    insert,
    chipLabel: isPath ? name : name,
    mono: isPath,
  };
}

function sortUnavailableLast(rows: PopupRow[]): PopupRow[] {
  return [
    ...rows.filter((row) => row.state !== "unavailable"),
    ...rows.filter((row) => row.state === "unavailable"),
  ];
}

export type MentionGroupInput = {
  items: readonly CompletionItem[];
  scope?: CompletionScopeId;
  /** Bare "@" served by a usage-ranked source → a single "Recent" group. */
  recent: boolean;
  totals?: ComposerSearchResponse["groups"];
  /** Group ids whose source is still refreshing. */
  loadingGroups?: ReadonlySet<string>;
};

export function buildMentionGroups(input: MentionGroupInput): PopupGroup[] {
  const rows = input.items.map(toPopupRow);
  if (input.scope) {
    const scope = completionScope(input.scope)!;
    const scoped = sortUnavailableLast(
      rows.filter(
        (row) => row.groupId === input.scope || row.groupId === "other",
      ),
    ).slice(0, SCOPED_ROW_LIMIT);
    const loading = input.loadingGroups?.has(scope.id);
    if (scoped.length === 0 && !loading) return [];
    return [
      { id: scope.id, label: scope.label, rows: scoped, loading: !!loading },
    ];
  }
  if (input.recent) {
    if (rows.length === 0) return [];
    return [
      {
        id: RECENT_GROUP_ID,
        label: "Recent",
        rows: sortUnavailableLast(rows).slice(0, RECENT_REQUEST_LIMIT),
        loading: !!input.loadingGroups?.size,
      },
    ];
  }
  const order: string[] = [];
  const byGroup = new Map<string, PopupRow[]>();
  for (const row of rows) {
    if (!byGroup.has(row.groupId)) {
      byGroup.set(row.groupId, []);
      order.push(row.groupId);
    }
    byGroup.get(row.groupId)!.push(row);
  }
  return order.map((id) => {
    const all = sortUnavailableLast(byGroup.get(id)!);
    const scope = completionScope(id);
    const shown = all.slice(0, UNSCOPED_GROUP_LIMIT);
    // Rows trimmed here plus the server's extra bounded matches.
    const server = input.totals?.find(
      (entry) => GROUP_SCOPE[entry.group] === id,
    );
    const more = all.length - shown.length + (server?.more ?? 0);
    return {
      id,
      label: scope?.label ?? "More",
      rows: shown,
      more: more > 0 && scope ? more : undefined,
      scope: scope?.id,
      loading: !!input.loadingGroups?.has(id),
    };
  });
}

export type SlashContext = { mode: "coding" | "planning"; running: boolean };

export function buildSlashGroups(
  items: readonly CompletionItem[],
  rawToken: string,
  context: SlashContext | undefined,
): PopupGroup[] {
  const needle = rawToken.replace(/^\//, "").toLowerCase();
  const byGroup = new Map<string, PopupRow[]>();
  for (const item of items) {
    const command = item.label.replace(/^\//, "");
    if (command === "abort" && !context?.running) continue;
    if (needle && !command.toLowerCase().includes(needle)) continue;
    const label = SLASH_GROUPS[command] ?? "Commands";
    const current =
      (command === "code" && context?.mode === "coding") ||
      (command === "plan" && context?.mode === "planning");
    const row: PopupRow = {
      id: `slash:${command}`,
      item,
      kind: "slash",
      groupId: label,
      name: command,
      meta: item.detail,
      state: "ready",
      toggleable: false,
      insert: item.label,
      chipLabel: command,
      command,
      current,
      mono: false,
    };
    byGroup.set(label, [...(byGroup.get(label) ?? []), row]);
  }
  // Commands starting with the typed text outrank substring matches.
  for (const rows of byGroup.values())
    rows.sort(
      (a, b) =>
        Number(!a.command!.startsWith(needle)) -
        Number(!b.command!.startsWith(needle)),
    );
  return SLASH_GROUP_ORDER.filter((label) => byGroup.has(label)).map(
    (label) => ({ id: label, label, rows: byGroup.get(label)! }),
  );
}

export const flattenRows = (groups: readonly PopupGroup[]): PopupRow[] =>
  groups.flatMap((group) => group.rows);

export function firstEligibleRow(
  groups: readonly PopupGroup[],
): PopupRow | undefined {
  const rows = flattenRows(groups);
  return rows.find((row) => row.state !== "unavailable") ?? rows[0];
}

/** Popup groups a source feeds; none declared → nothing is shown per group. */
export function groupsOfSource(
  source: ComposerSourceState,
): CompletionScopeId[] {
  return (source.groups ?? []).map((group) => GROUP_SCOPE[group]);
}

export function sourceLabel(source: ComposerSourceState): string {
  if (source.label) return source.label;
  const id = source.source.replace(/[-_.:]+/g, " ").trim();
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export function loadingState(
  sources: readonly ComposerSourceState[],
): Set<string> {
  const groups = new Set<string>();
  for (const source of sources) {
    if (source.status !== "loading" && !source.refreshing) continue;
    for (const id of groupsOfSource(source)) groups.add(id);
  }
  return groups;
}

/** Status bar message for the first unavailable source, naming the source. */
export function unavailableFooter(
  sources: readonly ComposerSourceState[],
): { footer: PopupFooter; source: ComposerSourceState } | undefined {
  const source = sources.find((entry) => entry.status === "unavailable");
  if (!source) return undefined;
  const action = source.action
    ? { label: SOURCE_ACTION_LABELS[source.action], id: source.action }
    : undefined;
  return {
    source,
    footer: {
      tone: "warning",
      icon: "offline",
      text: source.reason ?? `${sourceLabel(source)} isn’t available.`,
      action,
    },
  };
}
