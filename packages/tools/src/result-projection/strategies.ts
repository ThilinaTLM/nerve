import type {
  AgentResultProfileId,
  ProjectionCount,
} from "@nervekit/contracts";
import { ProjectionBudgetLedger } from "./budget-ledger.js";
import { blocksFit, measureBlocks, textHead, textTail } from "./measure.js";
import { profileBudget, type ProjectionBudget } from "./profiles.js";
import type {
  ProjectableBlock,
  ProjectionCandidate,
  SemanticItem,
} from "./types.js";

export type StrategyProjection = {
  blocks: ProjectableBlock[];
  counts: ProjectionCount[];
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

export function headTailText(
  candidate: ProjectionCandidate,
  profile: AgentResultProfileId,
): StrategyProjection {
  const budget = profileBudget(profile, "overflow");
  const notice = overflowNotice(
    candidate,
    "Output shortened with a head/tail view.",
  );
  const reserved = measureBlocks(notice);
  const text = candidate.blocks
    .filter(
      (block): block is Extract<ProjectableBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
  const lines = Math.max(1, budget.maxLines - reserved.lines);
  const bytes = Math.max(0, budget.maxBytes - reserved.bytes);
  const head = textHead(text, Math.floor(bytes / 2), Math.ceil(lines / 2));
  const tail = textTail(
    text,
    bytes - Buffer.byteLength(head, "utf8"),
    Math.floor(lines / 2),
  );
  const separator = head && tail ? "\n…\n" : "";
  const blocks: ProjectableBlock[] = [
    { type: "text", text: `${head}${separator}${tail}` },
    ...candidate.blocks.filter((block) => block.type === "image"),
    ...notice,
  ];
  return withLineCount(candidate, blocks);
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
  const notice = overflowNotice(candidate, itemNotice(original));
  const ledger = new ProjectionBudgetLedger(budget);
  ledger.commit(notice);
  const prefix = candidate.status ?? [];
  ledger.commit(prefix);
  const ordered = options.fromTail ? [...items].reverse() : items;
  const selected: SemanticItem[] = [];
  for (const item of ordered) {
    if (!ledger.commit(item.blocks, true)) continue;
    selected.push(item);
  }
  if (options.fromTail) selected.reverse();
  // Re-render in semantic order because a tail selection was tentatively committed in reverse.
  const blocks = [
    ...prefix,
    ...selected.flatMap((item) => item.blocks),
    ...notice,
  ];
  const measured = measureBlocks(blocks);
  if (measured.bytes > budget.maxBytes || measured.lines > budget.maxLines) {
    return boundTextCandidate({ ...candidate, blocks }, budget, "head");
  }
  return {
    blocks,
    counts: mergeUnitCount(candidate.counts, kind, original, selected.length),
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

export function compoundPerTask(
  projections: readonly StrategyProjection[],
): StrategyProjection {
  const blocks: ProjectableBlock[] = [];
  const counts: ProjectionCount[] = [];
  for (const [index, projection] of projections.entries()) {
    if (index === 0) {
      blocks.push(...projection.blocks);
    } else {
      const [first, ...rest] = projection.blocks;
      if (first?.type === "text")
        blocks.push({ type: "text", text: `\n${first.text}` }, ...rest);
      else blocks.push({ type: "text", text: "\n" }, ...projection.blocks);
    }
    counts.push(...projection.counts);
  }
  return { blocks, counts };
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
  const artifact = candidate.artifacts.find(
    (item) =>
      item.availability === "available" &&
      (item.role === "primary_result" || item.role === "overflow_recovery") &&
      item.access.kind === "agent_file",
  );
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

function itemNotice(total: number): string {
  return total > 0
    ? `Showing a bounded selection from ${total} result items.`
    : "Output shortened to fit the result budget.";
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
