import type {
  AgentResultProfileId,
  ExactContinuation,
  ProjectionCount,
} from "@nervekit/contracts/tools";
import { ProjectionBudgetLedger } from "./budget-ledger.js";
import { formatByteSize } from "../execution/output/truncate.js";
import {
  blocksFit,
  measureBlocks,
  measureText,
  textHead,
  textTail,
} from "./measure.js";
import { profileBudget, type ProjectionBudget } from "./profiles.js";
import type {
  ProjectableBlock,
  ProjectionCandidate,
  SemanticItem,
} from "./types.js";

export type StrategyProjection = {
  blocks: ProjectableBlock[];
  counts: ProjectionCount[];
  continuation?: ExactContinuation[];
};

export function unchangedIfFits(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection | undefined {
  const budget = profileBudget(profile, "inline");
  const itemCount = candidate.items?.length ?? 0;
  if (budget.maxItems !== undefined && itemCount > budget.maxItems) return;
  if (!blocksFit(candidate.blocks, budget)) return;
  return { blocks: candidate.blocks, counts: candidate.counts ?? [] };
}

export function headText(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  return boundTextCandidate(
    candidate,
    profileBudget(profile, "overflow"),
    "head",
  );
}

export function tailText(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  return boundTextCandidate(
    candidate,
    profileBudget(profile, "overflow"),
    "tail",
  );
}

const HEAD_TAIL_MAX_LINE_CHARS = 2_000;

/**
 * Contiguous head and tail lines of `candidate.body` (or its text), with `status` kept whole above them.
 * The budget's `headShare` splits the space; the notice states the ranges shown and the recovery file.
 */
export function headTailText(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  const budget = profileBudget(profile, "overflow");
  const prefix = joinText(candidate.status ?? []);
  const body = (candidate.body ?? joinText(candidate.blocks)).replace(
    /\r?\n$/,
    "",
  );
  const source = body.length > 0 ? body.split(/\r?\n/) : [];
  const total = source.length;
  const locator = recoveryLocator(candidate);
  const notice = (head: number, tailStart: number, omittedBytes: number) => {
    const ranges =
      tailStart >= total
        ? `lines 1-${head}`
        : head === 0
          ? `lines ${tailStart + 1}-${total}`
          : `lines 1-${head} and ${tailStart + 1}-${total}`;
    const shown =
      head >= tailStart
        ? "Long lines shortened."
        : `Showing ${ranges} of ${total}; ${formatByteSize(omittedBytes)} omitted.`;
    return `[${shown}${locator ? ` ${locator}` : ""}]`;
  };
  // Reserve the widest notice, the status prefix and the gap marker before selecting lines.
  const widest = `[Showing lines 1-${total} and ${total}-${total} of ${total}; ${formatByteSize(Buffer.byteLength(body, "utf8"))} omitted.${locator ? ` ${locator}` : ""}]`;
  const reserved = measureText(`${widest}        `);
  const prefixSize = prefix ? measureText(prefix) : { bytes: -1, lines: 0 };
  const maxBytes = Math.max(
    0,
    budget.maxBytes - (prefixSize.bytes + 1) - (reserved.bytes + 1) - 4,
  );
  const maxLines = Math.max(
    1,
    budget.maxLines - prefixSize.lines - reserved.lines - 1,
  );
  const shorten = (line: string) =>
    line.length > HEAD_TAIL_MAX_LINE_CHARS
      ? `${line.slice(0, HEAD_TAIL_MAX_LINE_CHARS - 1)}…`
      : line;
  const share = budget.headShare ?? 0.5;
  const head: string[] = [];
  let headBytes = 0;
  for (const line of source) {
    if (head.length >= Math.floor(maxLines * share)) break;
    const shown = shorten(line);
    const size = Buffer.byteLength(shown, "utf8") + 1;
    if (headBytes + size > Math.floor(maxBytes * share)) break;
    head.push(shown);
    headBytes += size;
  }
  const tail: string[] = [];
  let tailBytes = 0;
  for (let index = total - 1; index >= head.length; index -= 1) {
    if (head.length + tail.length >= maxLines) break;
    const shown = shorten(source[index]);
    const size = Buffer.byteLength(shown, "utf8") + 1;
    if (headBytes + tailBytes + size > maxBytes) {
      // One oversized final line still shows its end rather than nothing.
      if (head.length === 0 && tail.length === 0)
        tail.unshift(textTail(shown, maxBytes, 1));
      break;
    }
    tail.unshift(shown);
    tailBytes += size;
  }
  const tailStart = total - tail.length;
  const shownBytes = [
    ...source.slice(0, head.length),
    ...source.slice(tailStart),
  ].reduce((sum, line) => sum + Buffer.byteLength(line, "utf8") + 1, 0);
  const omittedBytes = Math.max(
    0,
    Buffer.byteLength(body, "utf8") + 1 - shownBytes,
  );
  const lines = [
    ...(prefix ? [prefix] : []),
    ...head,
    ...(tailStart > head.length && head.length > 0 && tail.length > 0
      ? ["…"]
      : []),
    ...tail,
    notice(head.length, tailStart, omittedBytes),
  ];
  const blocks: ProjectableBlock[] = [
    { type: "text", text: lines.join("\n") },
    ...candidate.blocks.filter((block) => block.type === "image"),
  ];
  return withLineCount(candidate, blocks);
}

function joinText(blocks: readonly ProjectableBlock[]): string {
  return blocks
    .filter(
      (block): block is Extract<ProjectableBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

/** One recovery locator: the combined output when retained, else stdout plus non-empty stderr. */
function recoveryLocator(candidate: ProjectionCandidate): string | undefined {
  const files = candidate.artifacts.flatMap((item) =>
    item.availability === "available" &&
    (item.role === "primary_result" || item.role === "overflow_recovery") &&
    item.access.kind === "agent_file"
      ? [{ item, path: item.access.path }]
      : [],
  );
  const named = (pattern: RegExp) =>
    files.find(({ item }) => pattern.test(`${item.id} ${item.label}`));
  const combined = named(/combined/i);
  if (combined) return `Full output: ${combined.path}`;
  const stdout = named(/stdout/i);
  const stderr = named(/stderr/i);
  const streams = [
    stdout && (stdout.item.size.bytes > 0 || !stderr)
      ? `stdout: ${stdout.path}`
      : undefined,
    stderr && stderr.item.size.bytes > 0 ? `stderr: ${stderr.path}` : undefined,
  ].filter((value): value is string => Boolean(value));
  if (streams.length > 0) return `Full output: ${streams.join("; ")}`;
  return files[0] ? `Full output: ${files[0].path}` : undefined;
}

export function itemAwareHead(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
  options: { fromTail?: boolean } = {},
): StrategyProjection {
  const budget = profileBudget(profile, "overflow");
  const items = candidate.items ?? [];
  const kind = unitKind(items);
  const original =
    candidate.counts?.find((count) => count.kind === kind)?.original ??
    items.length;
  const noun = candidate.overflow?.noun ?? unitNoun(kind);
  const reservedNotice = itemSelectionNotice(
    candidate,
    noun,
    original,
    original,
  );
  const ledger = new ProjectionBudgetLedger(budget);
  ledger.commit(reservedNotice);
  const prefix = candidate.status ?? [];
  ledger.commit(prefix);
  const ordered = options.fromTail ? [...items].reverse() : items;
  const selected: SemanticItem[] = [];
  for (const item of ordered) {
    if (!ledger.commit(item.blocks, true)) continue;
    selected.push(item);
  }
  if (options.fromTail) selected.reverse();
  const notice = itemSelectionNotice(
    candidate,
    noun,
    original,
    selected.length,
  );
  const blocks = combineAdjacentText([
    ...prefix,
    ...selected.flatMap((item) => item.blocks),
    ...notice,
  ]);
  const measured = measureBlocks(blocks);
  if (measured.bytes > budget.maxBytes || measured.lines > budget.maxLines) {
    return boundTextCandidate({ ...candidate, blocks }, budget, "head");
  }
  return {
    blocks,
    counts: mergeUnitCount(candidate.counts, kind, original, selected.length),
    continuation: candidate.continuation,
  };
}

export function continuationAwareHead(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  const lineContinuation = candidate.continuation?.find(
    (item) => item.kind === "line",
  );
  if (!lineContinuation) {
    const continuation = continuationNotice(candidate);
    return boundTextCandidate(
      candidate,
      profileBudget(profile, "overflow"),
      "head",
      continuation,
    );
  }
  const budget = profileBudget(profile, "overflow");
  const media = candidate.blocks.filter((block) => block.type === "image");
  const source = candidate.blocks
    .filter(
      (block): block is Extract<ProjectableBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text.replace(/\nRange: lines [^\n]+\.$/, ""))
    .join("\n");
  const reserve = `Continue with offset=${lineContinuation.displayedStart}; displayed ${lineContinuation.displayedStart}-000000 of ${lineContinuation.total}.`;
  const selected = textHead(
    source,
    Math.max(0, budget.maxBytes - Buffer.byteLength(reserve, "utf8")),
    Math.max(
      0,
      Math.min(
        budget.maxContentLines ?? budget.maxLines - 1,
        budget.maxLines - 1,
      ),
    ),
  );
  const displayedLines =
    selected.length === 0 ? 0 : selected.split("\n").length;
  const displayedEnd = Math.max(
    lineContinuation.displayedStart - 1,
    lineContinuation.displayedStart + displayedLines - 1,
  );
  const nextOffset = displayedEnd + 1;
  const noticeText = `Range: lines ${lineContinuation.displayedStart}-${displayedEnd} of ${lineContinuation.total}. Continue with offset=${nextOffset}.`;
  const blocks: ProjectableBlock[] = [
    ...(selected ? [{ type: "text" as const, text: selected }] : []),
    ...media,
    { type: "text", text: noticeText },
  ];
  return withLineCount(candidate, blocks);
}

export function compactDiagnosticIndex(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  return itemAwareHead(candidate, profile);
}

export function artifactIndex(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  const budget = profileBudget(profile, "overflow");
  const available = candidate.artifacts.filter(
    (artifact) => artifact.availability === "available",
  );
  const lines: string[] = [];
  for (const block of candidate.status ?? []) {
    if (block.type === "text") lines.push(block.text);
  }
  for (const artifact of available) {
    const location =
      artifact.access.kind === "agent_file"
        ? artifact.access.path
        : artifact.access.kind === "managed_reference"
          ? artifact.access.logicalPath
          : artifact.access.location;
    lines.push(
      `${artifact.label}: ${artifact.format.kind}, ${artifact.size.bytes} bytes${location ? `\nPath: ${location}` : ""}`,
    );
    if (artifact.recommendedTools.length > 0 && location) {
      lines.push(
        `Inspect with ${artifact.recommendedTools.join(" or ")}; do not rerun merely to recover output.`,
      );
    }
  }
  if (available.length === 0) {
    lines.push(
      "No validated recovery artifact is available; bounded inline details follow.",
    );
    return boundTextCandidate(candidate, budget, "head", [
      { type: "text", text: lines.join("\n") },
    ]);
  }
  const text = textHead(lines.join("\n"), budget.maxBytes, budget.maxLines);
  return withLineCount(candidate, [{ type: "text", text }]);
}

export function terminalOutcome(
  candidate: ProjectionCandidate,
): StrategyProjection {
  return boundTextCandidate(
    candidate,
    profileBudget("terminal_outcome", "overflow"),
    "tail",
  );
}

function boundTextCandidate(
  candidate: ProjectionCandidate,
  budget: ProjectionBudget,
  direction: "head" | "tail",
  fixedNotice?: ProjectableBlock[],
): StrategyProjection {
  const notice =
    fixedNotice ??
    overflowNotice(
      candidate,
      "Output shortened to fit the model result budget.",
    );
  const reserved = measureBlocks(notice);
  const maxBytes = Math.max(0, budget.maxBytes - reserved.bytes);
  const maxLines = Math.max(0, budget.maxLines - reserved.lines);
  const media = candidate.blocks.filter((block) => block.type === "image");
  const text = candidate.blocks
    .filter(
      (block): block is Extract<ProjectableBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
  const bounded =
    direction === "head"
      ? textHead(text, maxBytes, maxLines)
      : textTail(text, maxBytes, maxLines);
  const blocks: ProjectableBlock[] = [
    ...(bounded ? [{ type: "text" as const, text: bounded }] : []),
    ...media,
    ...notice,
  ];
  // A path can itself exhaust the budget. Prefer exact locator metadata and remove body.
  if (!blocksFit(blocks, budget)) {
    const locatorOnly = textHead(
      notice
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      budget.maxBytes,
      budget.maxLines,
    );
    return withLineCount(candidate, [{ type: "text", text: locatorOnly }]);
  }
  return withLineCount(candidate, blocks);
}

function overflowNotice(
  candidate: ProjectionCandidate,
  lead: string,
): ProjectableBlock[] {
  const recovery = recoveryText(candidate);
  return [{ type: "text", text: recovery ? `${lead}\n${recovery}` : lead }];
}

function recoveryText(candidate: ProjectionCandidate): string | undefined {
  const recoverable = candidate.artifacts.filter(
    (item) =>
      item.availability === "available" &&
      (item.role === "primary_result" || item.role === "overflow_recovery") &&
      item.access.kind === "agent_file",
  );
  const combined = recoverable.find(
    (item) =>
      item.id.includes("combined") ||
      item.label.toLowerCase().includes("combined"),
  );
  if (combined?.access.kind === "agent_file") {
    const tool = combined.recommendedTools[0] ?? "read";
    return `Complete result: ${combined.access.path} (use ${tool}; do not rerun merely to recover output).`;
  }
  if (recoverable.length > 1) {
    const paths = recoverable.flatMap((item) =>
      item.access.kind === "agent_file"
        ? [`${item.label}: ${item.access.path}`]
        : [],
    );
    if (paths.length > 0)
      return `Recovery files:\n${paths.join("\n")}\nInspect with read or grep; do not rerun merely to recover output.`;
  }
  const artifact = recoverable[0];
  if (!artifact || artifact.access.kind !== "agent_file") return;
  const tool = artifact.recommendedTools[0] ?? "read";
  return `Complete result: ${artifact.access.path} (use ${tool}; do not rerun merely to recover output).`;
}

function continuationNotice(
  candidate: ProjectionCandidate,
): ProjectableBlock[] {
  const lines = (candidate.continuation ?? []).map((continuation) => {
    switch (continuation.kind) {
      case "line":
        return `Continue with offset=${continuation.nextOffset}; displayed ${continuation.displayedStart}-${continuation.displayedEnd} of ${continuation.total}.`;
      case "byte":
        return `Continue with byteOffset=${continuation.nextByteOffset}; displayed bytes ${continuation.displayedStart}-${continuation.displayedEnd} of ${continuation.total}.`;
      case "cursor":
        return `Continue with ${continuation.cursorName}=${String(continuation.value)} (${continuation.direction}).`;
      case "page_token":
        return `Continue with ${continuation.parameter}=${continuation.value}.`;
    }
  });
  const recovery = recoveryText(candidate);
  if (recovery) lines.push(recovery);
  return [
    {
      type: "text",
      text:
        lines.length > 0
          ? lines.join("\n")
          : "Output shortened; refine the request to continue.",
    },
  ];
}

function itemSelectionNotice(
  candidate: ProjectionCandidate,
  noun: string,
  original: number,
  displayed: number,
): ProjectableBlock[] {
  const omitted = Math.max(0, original - displayed);
  const label = displayed === 1 ? noun : pluralNoun(noun);
  const lines = [
    `Showing ${displayed} of ${original} ${label}; ${omitted} omitted.`,
  ];
  if (candidate.overflow?.guidance) lines.push(candidate.overflow.guidance);
  for (const continuation of candidate.continuation ?? []) {
    switch (continuation.kind) {
      case "line":
        lines.push(`Continue with offset=${continuation.nextOffset}.`);
        break;
      case "byte":
        lines.push(`Continue with byteOffset=${continuation.nextByteOffset}.`);
        break;
      case "cursor":
        lines.push(
          `Continue with ${continuation.cursorName}=${String(continuation.value)}.`,
        );
        break;
      case "page_token":
        lines.push(
          `Continue with ${continuation.parameter}=${continuation.value}.`,
        );
        break;
    }
  }
  const recovery = recoveryText(candidate);
  if (recovery) lines.push(recovery);
  return [{ type: "text", text: lines.join("\n") }];
}

function unitNoun(kind: ProjectionCount["kind"]): string {
  if (kind === "event") return "event";
  if (kind === "task") return "task";
  return "item";
}

function pluralNoun(noun: string): string {
  if (noun.endsWith("y")) return `${noun.slice(0, -1)}ies`;
  if (noun.endsWith("s")) return noun;
  if (/(?:ch|sh|x|z)$/.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

function unitKind(items: readonly SemanticItem[]): ProjectionCount["kind"] {
  const kind = items[0]?.countsAs;
  return kind === "event" ? "event" : kind === "task" ? "task" : "item";
}

function mergeUnitCount(
  counts: readonly ProjectionCount[] | undefined,
  kind: ProjectionCount["kind"],
  original: number,
  displayed: number,
): ProjectionCount[] {
  return [
    ...(counts ?? []).filter((count) => count.kind !== kind),
    { kind, original, displayed, omitted: Math.max(0, original - displayed) },
  ];
}

function combineAdjacentText(
  blocks: readonly ProjectableBlock[],
): ProjectableBlock[] {
  const output: ProjectableBlock[] = [];
  for (const block of blocks) {
    const previous = output.at(-1);
    if (block.type === "text" && previous?.type === "text") {
      previous.text = `${previous.text}\n${block.text}`;
    } else {
      output.push({ ...block });
    }
  }
  return output;
}

function withLineCount(
  candidate: ProjectionCandidate,
  blocks: ProjectableBlock[],
): StrategyProjection {
  const original = measureBlocks(candidate.blocks);
  const displayed = measureBlocks(blocks);
  return {
    blocks,
    counts: [
      ...(candidate.counts ?? []).filter(
        (count) => count.kind !== "line" && count.kind !== "byte",
      ),
      {
        kind: "line",
        original: original.lines,
        displayed: displayed.lines,
        omitted: Math.max(0, original.lines - displayed.lines),
      },
      {
        kind: "byte",
        original: original.bytes,
        displayed: displayed.bytes,
        omitted: Math.max(0, original.bytes - displayed.bytes),
      },
    ],
  };
}
