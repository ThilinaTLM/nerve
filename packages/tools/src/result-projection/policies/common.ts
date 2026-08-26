/* eslint-disable max-lines -- shared semantic candidate builders keep all tool families on one reviewed vocabulary. */
import type {
  AgentResultProfileId,
  AgentResultStrategyId,
  ExactContinuation,
  ProjectionCount,
  ValidatedToolArtifact,
} from "@nervekit/contracts";
import { fallbackText, validContentBlocks } from "../fallback.js";
import { textHead } from "../measure.js";
import type {
  AgentResultPolicy,
  CandidateContext,
  ProjectableBlock,
  ProjectionCandidate,
  SemanticItem,
  TerminalResource,
} from "../types.js";

export function defineAgentResultPolicy(
  policy: AgentResultPolicy,
): AgentResultPolicy {
  return Object.freeze(policy);
}

export function policy(
  profile:
    | AgentResultProfileId
    | ((context: CandidateContext) => AgentResultProfileId),
  overflow: AgentResultStrategyId,
  buildCandidate: AgentResultPolicy["buildCandidate"],
): AgentResultPolicy {
  return defineAgentResultPolicy({
    profile,
    overflow,
    buildCandidate,
    terminalResource: safeTerminalResource,
  });
}

export function textCandidate(context: CandidateContext): ProjectionCandidate {
  return {
    blocks: validContentBlocks(context.result) ?? [
      { type: "text", text: fallbackText(context.result) },
    ],
    artifacts: artifacts(context),
  };
}

export function sourceCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  const blocks = validContentBlocks(result);
  const content =
    typeof result.content === "string" ? result.content : undefined;
  if (!blocks && content === undefined) return;
  const details = record(result.details);
  const range = record(details.range);
  const truncation = record(details.truncation);
  const continuation: ExactContinuation[] = [];
  const nextOffset =
    number(range.nextOffset) ??
    number(truncation.nextOffset) ??
    number(record(record(details.outputLimits).continuation).nextOffset);
  const nextByteOffset =
    number(range.nextByteOffset) ??
    number(truncation.nextByteOffset) ??
    number(record(record(details.outputLimits).continuation).nextByteOffset);
  const totalLines = number(range.sourceTotalLines);
  const totalBytes = number(range.sourceBytes);
  if (nextOffset !== undefined) {
    continuation.push({
      kind: "line",
      nextOffset,
      displayedStart:
        number(range.returnedStartLine) ??
        number(range.requestedStartLine) ??
        1,
      displayedEnd:
        number(range.returnedEndLine) ?? Math.max(0, nextOffset - 1),
      total:
        totalLines ??
        Math.max(nextOffset, number(truncation.originalLines) ?? nextOffset),
    });
  } else if (
    range.mode === "lines" &&
    number(range.returnedContentLines) !== undefined &&
    number(range.returnedContentLines)! > 200
  ) {
    const start = number(range.returnedStartLine) ?? 1;
    const total = totalLines ?? start + number(range.returnedContentLines)! - 1;
    continuation.push({
      kind: "line",
      nextOffset: start + 200,
      displayedStart: start,
      displayedEnd: start + 199,
      total,
    });
  } else if (nextByteOffset !== undefined) {
    continuation.push({
      kind: "byte",
      nextByteOffset,
      displayedStart:
        number(range.utf8AdjustedStart) ?? number(range.returnedByteStart) ?? 0,
      displayedEnd:
        number(range.utf8AdjustedEnd) ??
        number(range.returnedByteEnd) ??
        nextByteOffset,
      total:
        totalBytes ??
        Math.max(
          nextByteOffset,
          number(truncation.originalBytes) ?? nextByteOffset,
        ),
    });
  }
  const canonicalBlocks = blocks ?? [
    { type: "text" as const, text: content ?? "" },
  ];
  if (typeof range.mode === "string" && canonicalBlocks[0]?.type === "text") {
    const rangeLine =
      range.mode === "lines"
        ? `Range: lines ${String(range.returnedStartLine ?? 1)}-${String(range.returnedEndLine ?? 0)} of ${String(range.sourceTotalLines ?? "unknown")}.`
        : `Range: bytes ${String(range.utf8AdjustedStart ?? range.returnedByteStart ?? 0)}-${String(range.utf8AdjustedEnd ?? range.returnedByteEnd ?? 0)} of ${String(range.sourceBytes ?? "unknown")}.`;
    canonicalBlocks[0] = {
      type: "text",
      text: `${canonicalBlocks[0].text}\n${rangeLine}`,
    };
  }
  return {
    blocks: canonicalBlocks,
    continuation,
    artifacts: artifacts(context),
  };
}

export function processCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  if (
    typeof result.stdout !== "string" &&
    typeof result.stderr !== "string" &&
    typeof result.content !== "string"
  )
    return;
  const stdout = string(result.stdout);
  const stderr = string(result.stderr);
  const details = record(result.details);
  const truncation = record(details.truncation);
  const omitted =
    truncation.truncated === true
      ? `Retention: omitted ${String(truncation.omittedLines ?? "?")} lines / ${String(truncation.omittedBytes ?? "?")} bytes from the inline execution view.`
      : undefined;
  const statusLines = [
    `Process ${result.exitCode === undefined ? "finished" : `exit code ${String(result.exitCode)}`}.`,
    typeof result.signal === "string"
      ? `Signal: ${result.signal}`
      : typeof details.signal === "string"
        ? `Signal: ${details.signal}`
        : undefined,
    details.timedOut === true || result.timedOut === true
      ? "Timed out: yes"
      : undefined,
    number(details.durationMs) !== undefined
      ? `Duration: ${String(details.durationMs)} ms`
      : undefined,
    omitted,
  ].filter((line): line is string => Boolean(line));
  const groups: string[] = [];
  if (stdout) groups.push(`stdout:\n${stdout}`);
  if (stderr) groups.push(`stderr:\n${stderr}`);
  if (groups.length === 0 && typeof result.content === "string")
    groups.push(result.content);
  const fullText = [...groups, statusLines.join("\n")]
    .filter(Boolean)
    .join("\n\n");
  const diagnosticLines = diagnosticItems(
    stdout,
    stderr,
    result.exitCode,
    result.timedOut === true || details.timedOut === true,
  );
  return {
    blocks: [{ type: "text", text: fullText }],
    status: [{ type: "text", text: statusLines.join("\n") }],
    items: diagnosticLines,
    artifacts: artifacts(context),
  };
}

export function listingCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  const details = record(result.details);
  if (!Array.isArray(result.entries)) return;
  const root = typeof result.path === "string" ? result.path : ".";
  const items: SemanticItem[] = result.entries.map((entry, index) => {
    const value = record(entry);
    const path =
      typeof value.path === "string" ? value.path : fallbackText(entry);
    const kind = typeof value.kind === "string" ? ` (${value.kind})` : "";
    return {
      id: String(index),
      countsAs: "item",
      blocks: [{ type: "text", text: `${path}${kind}` }],
    };
  });
  const blocks: ProjectableBlock[] = [
    {
      type: "text",
      text: [`Root: ${root}`, ...items.map((item) => textOf(item.blocks))].join(
        "\n",
      ),
    },
  ];
  return {
    blocks,
    status: [{ type: "text", text: `Root: ${root}` }],
    items,
    counts: [
      count(
        "item",
        number(details.total) ?? number(result.total) ?? items.length,
        items.length,
      ),
    ],
    artifacts: artifacts(context),
  };
}

export function grepCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  const details = record(result.details);
  if (!Array.isArray(result.matches)) return;
  const root = typeof result.path === "string" ? result.path : ".";
  const items: SemanticItem[] = result.matches.map((match, index) => {
    const value = record(match);
    const path = string(value.path) || root;
    const line = number(value.line) ?? number(value.lineNumber);
    const text = string(value.text) || fallbackText(match);
    return {
      id: `${path}:${line ?? index}`,
      countsAs: "item",
      blocks: [
        {
          type: "text",
          text: `${path}${line !== undefined ? `:${line}` : ""}: ${text}`,
        },
      ],
    };
  });
  return {
    blocks: [
      {
        type: "text",
        text: [
          `Root: ${root}`,
          ...items.map((item) => textOf(item.blocks)),
        ].join("\n"),
      },
    ],
    status: [{ type: "text", text: `Root: ${root}` }],
    items,
    counts: [
      count(
        "item",
        number(details.total) ?? number(result.total) ?? items.length,
        items.length,
      ),
    ],
    artifacts: artifacts(context),
  };
}

export function searchCandidate(
  context: CandidateContext,
): ProjectionCandidate | undefined {
  const result = record(context.result);
  const details = record(result.details);
  const values =
    array(details.results) ??
    array(result.results) ??
    array(details.issues) ??
    array(details.pages) ??
    array(details.spaces) ??
    array(details.users) ??
    array(details.boards);
  if (!values) return textCandidate(context);
  const query = firstString(
    details.query,
    details.jql,
    details.cql,
    result.query,
  );
  const answer = firstString(details.answer, result.answer);
  const header = [query ? `Query: ${query}` : undefined, answer].filter(
    (value): value is string => Boolean(value),
  );
  const items: SemanticItem[] = values.slice(0, 10).map((value, index) => ({
    id: String(index),
    countsAs: "item",
    blocks: [{ type: "text", text: semanticSummary(value, index + 1) }],
  }));
  const continuation = continuations(details);
  return {
    blocks: [
      {
        type: "text",
        text: [...header, ...items.map((item) => textOf(item.blocks))].join(
          "\n\n",
        ),
      },
    ],
    status:
      header.length > 0 ? [{ type: "text", text: header.join("\n") }] : [],
    items,
    continuation,
    counts: [
      count("item", number(details.total) ?? values.length, items.length),
    ],
    artifacts: artifacts(context),
  };
}

export function mutationCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const safe = pickSemantic({ ...result, ...details }, [
    "operation",
    "action",
    "outcome",
    "success",
    "dryRun",
    "path",
    "bytes",
    "bytesWritten",
    "id",
    "key",
    "issueKey",
    "pageId",
    "attachmentId",
    "status",
    "state",
    "version",
    "url",
    "warning",
    "warnings",
    "error",
    "message",
    "mode",
    "planPath",
    "reviewId",
  ]);
  const content = validContentBlocks(result)
    ?.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const text =
    Object.keys(safe).length > 0
      ? formatFlat(safe)
      : content || "Operation completed.";
  return { blocks: [{ type: "text", text }], artifacts: artifacts(context) };
}

export function lifecycleCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const values =
    array(result.tasks) ??
    array(details.tasks) ??
    array(result.todos) ??
    array(details.todos) ??
    (result.task && typeof result.task === "object"
      ? [result.task, ...(array(result.otherActiveTasks) ?? [])]
      : undefined);
  if (!values) return mutationCandidate(context);
  const items: SemanticItem[] = values.map((value, index) => ({
    id: String(index),
    countsAs: "item",
    blocks: [
      {
        type: "text",
        text: semanticSummary(value, index + 1, [
          "command",
          "env",
          "content",
          "body",
        ]),
      },
    ],
  }));
  const title =
    firstString(result.content, details.message) ?? `${values.length} items`;
  return {
    blocks: [
      {
        type: "text",
        text: [title, ...items.map((item) => textOf(item.blocks))].join("\n"),
      },
    ],
    status: [{ type: "text", text: title.split("\n", 1)[0] ?? title }],
    items,
    counts: [count("item", values.length, values.length)],
    artifacts: artifacts(context),
  };
}

export function resourceCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const semantic = Object.keys(details).length > 0 ? details : result;
  const text = semanticObjectText(semantic, 0);
  return {
    blocks: [{ type: "text", text: text || fallbackText(context.result) }],
    artifacts: artifacts(context),
  };
}

export function webFetchCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const metadata = [
    typeof details.url === "string"
      ? `URL: ${sanitizeUrl(details.url)}`
      : undefined,
    details.status !== undefined
      ? `HTTP status: ${String(details.status)}`
      : undefined,
    typeof details.contentType === "string"
      ? `Content-Type: ${details.contentType}`
      : undefined,
    details.size !== undefined ? `Bytes: ${String(details.size)}` : undefined,
    details.converted === true ? "Converted: markdown" : undefined,
  ].filter((line): line is string => Boolean(line));
  const body =
    typeof result.content === "string" ? result.content : fallbackText(result);
  return {
    blocks: [{ type: "text", text: [...metadata, body].join("\n\n") }],
    status:
      metadata.length > 0 ? [{ type: "text", text: metadata.join("\n") }] : [],
    artifacts: artifacts(context),
  };
}

export function humanCandidate(context: CandidateContext): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const response =
    firstString(
      result.response,
      result.feedback,
      result.answer,
      details.response,
      details.feedback,
      details.answer,
      result.content,
    ) ?? fallbackText(result);
  const identity = pickSemantic(
    { ...result, ...details, ...record(result.review) },
    [
      "questionId",
      "interactionId",
      "interactionOrdinal",
      "ordinal",
      "reviewId",
      "planPath",
      "decision",
      "outcome",
      "status",
      "mode",
    ],
  );
  const prefix =
    Object.keys(identity).length > 0 ? `${formatFlat(identity)}\n\n` : "";
  return {
    blocks: [{ type: "text", text: `${prefix}${response}` }],
    artifacts: artifacts(context),
  };
}

export function taskLogsCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const response = { ...result, ...details };
  const events =
    array(result.events) ?? array(details.events) ?? array(response.events);
  if (!events) return textCandidate(context);
  const items: SemanticItem[] = events.map((event, index) => {
    const value = record(event);
    const seq = number(value.seq) ?? index;
    const stream = string(value.stream) || "log";
    const raw = record(value.raw);
    const streamArtifacts = record(result.streamArtifacts);
    const path =
      stream === "stdout"
        ? string(streamArtifacts.stdoutPath)
        : string(streamArtifacts.stderrPath);
    const range =
      number(raw.start) !== undefined && number(raw.end) !== undefined
        ? ` [${path ? `${path} ` : ""}bytes ${String(raw.start)}-${String(raw.end)}]`
        : "";
    const prefix = `${seq} [${stream}] `;
    const suffix = range;
    const maxPayloadBytes = Math.max(
      0,
      512 - Buffer.byteLength(prefix + suffix, "utf8"),
    );
    const originalLine = string(value.line);
    const displayedLine =
      path && Buffer.byteLength(originalLine, "utf8") > maxPayloadBytes
        ? maxPayloadBytes >= 3
          ? `${textHead(originalLine, maxPayloadBytes - 3, 1)}…`
          : ""
        : originalLine;
    return {
      id: String(seq),
      countsAs: "event",
      blocks: [{ type: "text", text: `${prefix}${displayedLine}${suffix}` }],
    };
  });
  return {
    blocks: [
      {
        type: "text",
        text: items.map((item) => textOf(item.blocks)).join("\n"),
      },
    ],
    status: [],
    items,
    continuation: continuations({ ...details, ...response }),
    counts: [
      count(
        "event",
        number(response.originalEventCount) ??
          number(response.total) ??
          events.length,
        events.length,
      ),
    ],
    artifacts: artifacts(context),
  };
}

export function exploreCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const reports =
    array(result.reports) ?? array(record(result.details).reports);
  if (!reports) return textCandidate(context);
  return {
    blocks: [
      {
        type: "text",
        text: reports
          .map((report, index) => semanticSummary(report, index + 1))
          .join("\n\n"),
      },
    ],
    tasks: reports.map((report, index) => {
      const value = record(report);
      const text =
        firstString(value.report, value.content, value.summary) ??
        semanticSummary(report, index + 1);
      const heading = `Task ${index + 1}${typeof value.label === "string" ? ` — ${value.label}` : ""}: ${string(value.status) || "completed"}`;
      const reportPath = string(value.reportPath);
      const metadata = reportPath
        ? `Report: ${reportPath}${value.reportBytes !== undefined ? ` (${String(value.reportBytes)} bytes, ${String(value.reportLines ?? "?")} lines)` : ""}`
        : "";
      const preview =
        firstString(value.summaryPreview) ?? "No summary was provided.";
      return {
        index,
        candidate: {
          blocks: [
            {
              type: "text",
              text: [heading, text, metadata].filter(Boolean).join("\n"),
            },
          ],
          status: [
            {
              type: "text",
              text: [heading, preview, metadata].filter(Boolean).join("\n"),
            },
          ],
          artifacts: artifacts(context).filter(
            (artifact) =>
              artifact.id === String(value.artifactId) ||
              artifact.label.includes(string(value.label)),
          ),
        },
      };
    }),
    artifacts: artifacts(context),
  };
}

export function primaryFileCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const candidate = mutationCandidate(context);
  return { ...candidate, status: candidate.blocks };
}

export function safeTerminalResource(
  context: CandidateContext,
): TerminalResource | undefined {
  const args = record(context.args);
  const result = record(context.result);
  const details = record(result.details);
  const value = firstString(
    result.path,
    details.path,
    details.url,
    args.path,
    args.taskId,
    result.taskId,
    details.taskId,
    result.issueKey,
    details.issueKey,
    result.pageId,
    details.pageId,
    result.reviewId,
    details.reviewId,
  );
  if (!value) return;
  return {
    label: sanitizeUrl(value),
    state: firstString(
      result.status,
      details.status,
      result.state,
      details.state,
    ),
  };
}

function diagnosticItems(
  stdout: string,
  stderr: string,
  exitCode: unknown,
  timedOut: boolean,
): SemanticItem[] {
  const all = [
    ...stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({ stream: "stdout", line })),
    ...stderr
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => ({ stream: "stderr", line })),
  ];
  const diagnostic = all.filter(({ line }) =>
    /\b(error|warn(?:ing)?|fatal|fail(?:ed|ure)?|exception|traceback|timeout|timed out)\b/i.test(
      line,
    ),
  );
  const selected = (
    diagnostic.length > 0 ? diagnostic : exitCode !== 0 || timedOut ? all : []
  ).slice(-8);
  return selected.map(({ stream, line }, index) => ({
    id: String(index),
    countsAs: "event",
    blocks: [{ type: "text", text: `[${stream}] ${line}` }],
  }));
}

function artifacts(context: CandidateContext): ValidatedToolArtifact[] {
  const values = [...context.validatedArtifacts];
  if (
    context.completePayload &&
    !values.some((artifact) => artifact.id === context.completePayload?.id)
  )
    values.push(context.completePayload);
  return values;
}

function continuations(value: Record<string, unknown>): ExactContinuation[] {
  const output: ExactContinuation[] = [];
  const next = value.nextPageToken ?? value.next_page_token;
  if (typeof next === "string")
    output.push({
      kind: "page_token",
      parameter: "nextPageToken",
      value: next,
    });
  const cursor = value.nextCursor ?? value.cursor;
  if (typeof cursor === "string" || typeof cursor === "number")
    output.push({
      kind: "cursor",
      cursorName: "cursor",
      value: cursor,
      direction: "after",
    });
  const older = number(value.olderBeforeSeq) ?? number(value.beforeSeq);
  if (older !== undefined)
    output.push({
      kind: "cursor",
      cursorName: "beforeSeq",
      value: older,
      direction: "before",
    });
  const future = number(value.futureSinceSeq) ?? number(value.nextCursor);
  if (future !== undefined)
    output.push({
      kind: "cursor",
      cursorName: "sinceSeq",
      value: future,
      direction: "after",
    });
  return output;
}

function semanticSummary(
  value: unknown,
  index: number,
  excluded: string[] = [],
): string {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return `${index}. ${String(value)}`;
  const safe = pickSemantic(
    record(value),
    [
      "title",
      "name",
      "key",
      "id",
      "status",
      "state",
      "type",
      "url",
      "path",
      "email",
      "displayName",
      "snippet",
      "summary",
      "todo",
      "done",
      "line",
      "text",
    ].filter((key) => !excluded.includes(key)),
  );
  return `${index}. ${Object.keys(safe).length > 0 ? formatFlat(safe).replaceAll("\n", " · ") : fallbackText(value)}`;
}

function semanticObjectText(value: unknown, depth: number): string {
  if (depth > 3) return "";
  if (Array.isArray(value))
    return value
      .slice(0, 3)
      .map((item, index) => semanticSummary(item, index + 1))
      .join("\n");
  if (!value || typeof value !== "object") return String(value ?? "");
  const ignored =
    /^(raw|rawResult|contentBlocks|body|description|submitted|payload|request|input|adf|storage)$/i;
  const lines: string[] = [];
  for (const [key, nested] of Object.entries(record(value))) {
    if (ignored.test(key) || nested === undefined || nested === null) continue;
    if (Array.isArray(nested)) {
      lines.push(`${key}: ${nested.length}`);
      const preview = nested
        .slice(0, 3)
        .map((item, index) => semanticSummary(item, index + 1))
        .join("\n");
      if (preview) lines.push(preview);
    } else if (typeof nested === "object") {
      const child = semanticObjectText(nested, depth + 1);
      if (child) lines.push(`${key}:\n${child}`);
    } else if (typeof nested === "string" && nested.length > 2_000) {
      lines.push(`${key}: ${nested.slice(0, 2_000)}…`);
    } else lines.push(`${key}: ${String(nested)}`);
  }
  return lines.join("\n");
}

function pickSemantic(
  value: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of keys)
    if (value[key] !== undefined && value[key] !== null)
      output[key] = value[key];
  return output;
}

function formatFlat(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(
      ([key, nested]) =>
        `${key}: ${Array.isArray(nested) ? nested.map(String).join(", ") : String(nested)}`,
    )
    .join("\n");
}

function count(
  kind: ProjectionCount["kind"],
  original: number,
  displayed: number,
): ProjectionCount {
  return {
    kind,
    original,
    displayed,
    omitted: Math.max(0, original - displayed),
  };
}

function textOf(blocks: readonly ProjectableBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function array(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}
function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|auth|signature|credential|password|secret/i.test(key))
        url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}
