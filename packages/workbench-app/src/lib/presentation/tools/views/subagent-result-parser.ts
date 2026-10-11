import type {
  SubagentAssignmentView,
  SubagentStatusRow,
  SubagentStopLine,
} from "./tool-view-types";

/*
 * Sub-agent tool results are plain text (see agent-interface.md). These
 * parsers read the documented line formats and never throw; a line that does
 * not match is simply left out, so the card falls back to the raw text.
 */

const FIELD_SEPARATOR = " · ";

function lines(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export type PromptResultLine = {
  name: string;
  profile: string;
  disposition: "created" | "follow_up";
  /** State in parentheses after "follow-up queued". */
  queuedState?: string;
};

/** `name (profile): created` or `name (profile): follow-up queued (running)`. */
export function parsePromptResult(
  text: string | undefined,
): PromptResultLine[] {
  const parsed: PromptResultLine[] = [];
  for (const line of lines(text)) {
    const match = /^(.+?) \(([^()]+)\): (.+)$/.exec(line);
    if (!match) continue;
    const [, name, profile, outcome] = match;
    if (outcome === "created")
      parsed.push({ name, profile, disposition: "created" });
    else if (outcome.startsWith("follow-up"))
      parsed.push({
        name,
        profile,
        disposition: "follow_up",
        queuedState: /\(([^()]+)\)\s*$/.exec(outcome)?.[1],
      });
  }
  return parsed;
}

/** Assignments from the call arguments, enriched by the result lines. */
export function subagentAssignments(
  args: Record<string, unknown>,
  result: string | undefined,
): SubagentAssignmentView[] {
  const results = new Map(
    parsePromptResult(result).map((line) => [line.name.toLowerCase(), line]),
  );
  const raw = Array.isArray(args.assignments) ? args.assignments : [];
  const assignments: SubagentAssignmentView[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name) continue;
    const line = results.get(record.name.toLowerCase());
    assignments.push({
      name: record.name,
      profile:
        typeof record.profile === "string" && record.profile
          ? record.profile
          : line?.profile,
      prompt: typeof record.prompt === "string" ? record.prompt : "",
      disposition: line?.disposition,
      queuedState: line?.queuedState,
    });
  }
  return assignments;
}

/**
 * `name · profile · state · ctx 34% · active 20s ago`. The state may carry a
 * reason (`waiting: 1 background command`).
 */
export function parseStatusListing(
  text: string | undefined,
): SubagentStatusRow[] {
  const rows: SubagentStatusRow[] = [];
  for (const line of lines(text)) {
    const fields = line.split(FIELD_SEPARATOR).map((field) => field.trim());
    if (fields.length < 3) continue;
    const [name, profile, state, ...rest] = fields;
    const context = rest.find((field) => /^ctx\b/.test(field));
    const activity = rest.filter((field) => field !== context).join(" · ");
    rows.push({
      name,
      profile,
      state,
      context: context?.replace(/^ctx\s*/, ""),
      activity: activity || undefined,
    });
  }
  return rows;
}

/** A single sub-agent's answer: a header line, then the response or activity. */
export function parseStatusDetail(text: string | undefined): {
  header?: string;
  body?: string;
} {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return {};
  const newline = trimmed.indexOf("\n");
  if (newline < 0) return { header: trimmed };
  return {
    header: trimmed.slice(0, newline).trim(),
    body: trimmed.slice(newline + 1).trim() || undefined,
  };
}

/** `name: stopped` style lines, one per stopped sub-agent. */
export function parseStopResult(text: string | undefined): SubagentStopLine[] {
  const parsed: SubagentStopLine[] = [];
  for (const line of lines(text)) {
    const match = /^(.+?): (.+)$/.exec(line);
    if (match) parsed.push({ name: match[1], outcome: match[2] });
  }
  return parsed;
}

export type SubagentNotice = {
  name: string;
  profile?: string;
  outcome: "completed" | "failed" | "interrupted" | "stopped" | "waiting";
  /** Failure message, or the waiting reason lines. */
  detail?: string;
  /** The sub-agent's response, without the truncation marker. */
  response: string;
  /** Path of the full response when the notice truncated it. */
  reportPath?: string;
};

const TRUNCATION = /\n?\[truncated; full response: ([^\]\n]+)\]\s*$/;

/**
 * The completion notice sent to the lead:
 * `Sub-agent "name" (profile) completed.` and variants, then the response.
 */
export function parseSubagentNotice(
  text: string | undefined,
): SubagentNotice | undefined {
  const source = (text ?? "").trim();
  const head = /^Sub-agent "(.+?)"(?: \(([^()]+)\))? (.*)$/m.exec(source);
  if (!head || head.index !== 0) return undefined;
  const [firstLine, name, profile, rest] = head;
  let outcome: SubagentNotice["outcome"];
  let detail: string | undefined;
  let afterFirst = source.slice(firstLine.length).replace(/^\n/, "");
  if (rest === "completed.") outcome = "completed";
  else if (rest === "interrupted.") outcome = "interrupted";
  else if (rest === "was stopped by the user.") outcome = "stopped";
  else if (rest.startsWith("failed:")) {
    outcome = "failed";
    detail = rest.slice("failed:".length).trim() || undefined;
  } else if (rest.startsWith("is waiting on ")) {
    outcome = "waiting";
    // One line per background command follows the first line.
    const commands: string[] = [];
    const remaining = afterFirst.split("\n");
    while (remaining.length && /^"[^\n]*" \S/.test(remaining[0]))
      commands.push(remaining.shift()!);
    detail = commands.join("\n") || undefined;
    afterFirst = remaining.join("\n");
  } else return undefined;
  const truncated = TRUNCATION.exec(afterFirst);
  const response = (
    truncated ? afterFirst.slice(0, truncated.index) : afterFirst
  ).trim();
  return {
    name,
    profile,
    outcome,
    detail,
    response,
    reportPath: truncated?.[1].trim(),
  };
}
