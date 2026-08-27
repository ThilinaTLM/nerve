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
import { formatWebFetchCandidateText } from "../candidates/web.js";
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
  const streams = record(details.streams);
  const combined = record(streams.combined);
  const timedOut = details.timedOut === true || result.timedOut === true;
  const exitCode = number(result.exitCode) ?? number(details.exitCode);
  const basicStatus = [
    `Process ${exitCode === undefined ? "finished" : `exit code ${String(exitCode)}`}.`,
    typeof result.signal === "string"
      ? `Signal: ${result.signal}`
      : typeof details.signal === "string"
        ? `Signal: ${details.signal}`
        : undefined,
    timedOut ? "Timed out: yes" : undefined,
    number(details.durationMs) !== undefined
      ? `Duration: ${String(details.durationMs)} ms`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const outputFacts = [
    number(combined.lines) !== undefined
      ? `Output lines: ${String(combined.lines)}`
      : undefined,
    number(combined.bytes) !== undefined
      ? `Output bytes: ${String(combined.bytes)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const producerStatusIncluded = details.processStatusIncluded === true;
  const body =
    typeof result.content === "string"
      ? result.content
      : [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""]
          .filter(Boolean)
          .join("\n\n");
  const fullText = [
    body,
    producerStatusIncluded ? undefined : basicStatus.join("\n"),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const diagnosticLines = diagnosticItems(stdout, stderr, exitCode, timedOut);
  return {
    blocks: [{ type: "text", text: fullText }],
    status: [
      { type: "text", text: [...basicStatus, ...outputFacts].join("\n") },
    ],
    items: diagnosticLines,
    overflow: { noun: "diagnostic line" },
    counts:
      number(combined.lines) !== undefined
        ? [count("event", number(combined.lines)!, diagnosticLines.length)]
        : undefined,
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
  const original =
    number(details.totalEntries) ??
    number(details.total) ??
    number(result.total) ??
    items.length;
  const footer =
    original > items.length
      ? `Showing ${items.length} of ${original} entries; ${original - items.length} omitted by the requested limit.`
      : undefined;
  const blocks: ProjectableBlock[] = [
    {
      type: "text",
      text: [
        `Root: ${root}`,
        ...items.map((item) => textOf(item.blocks)),
        footer,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n"),
    },
  ];
  return {
    blocks,
    status: [{ type: "text", text: `Root: ${root}` }],
    items,
    overflow: {
      noun: "entry",
      guidance:
        "Refine the requested path/pattern or inspect the complete result payload.",
    },
    counts: [count("item", original, items.length)],
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
  const producerNotice =
    details.producerLimitReached === true
      ? "Producer match limit reached; increase limit or refine the pattern for additional matches."
      : undefined;
  return {
    blocks: [
      {
        type: "text",
        text: [
          `Root: ${root}`,
          ...items.map((item) => textOf(item.blocks)),
          producerNotice,
        ]
          .filter((value): value is string => Boolean(value))
          .join("\n"),
      },
    ],
    status: [{ type: "text", text: `Root: ${root}` }],
    items,
    overflow: {
      noun: "match",
      guidance:
        "Refine the pattern or inspect the complete result payload for omitted matches.",
    },
    counts: [
      count(
        "item",
        number(details.totalMatches) ??
          number(details.total) ??
          number(result.total) ??
          items.length,
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
  const header = [
    query ? `Query: ${query}` : undefined,
    answer,
    ...artifactNoticeLines(artifacts(context), "supporting_data"),
  ].filter((value): value is string => Boolean(value));
  const items: SemanticItem[] = values.slice(0, 10).map((value, index) => ({
    id: String(index),
    countsAs: "item",
    blocks: [{ type: "text", text: semanticSummary(value, index + 1) }],
  }));
  const continuation = continuations(details);
  const original =
    firstNumber(
      details.total,
      details.issueCount,
      details.userCount,
      details.boardCount,
      details.pageCount,
      details.spaceCount,
    ) ?? values.length;
  const footer = [
    `Showing ${items.length} of ${original} results; ${Math.max(0, original - items.length)} omitted.`,
    ...continuation.map(continuationText),
  ];
  return {
    blocks: [
      {
        type: "text",
        text: [
          ...header,
          ...items.map((item) => textOf(item.blocks)),
          ...footer,
        ].join("\n\n"),
      },
    ],
    status:
      header.length > 0 ? [{ type: "text", text: header.join("\n") }] : [],
    items,
    overflow: { noun: "result" },
    continuation,
    counts: [count("item", original, items.length)],
    artifacts: artifacts(context),
  };
}

export function mutationCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const summary = record(details.mutationSummary);
  const lines: string[] = [];
  const transitions = array(details.transitions) ?? [];
  if (Object.keys(summary).length > 0) {
    lines.push(
      `Operation: ${string(summary.operation) || context.toolName}`,
      `Outcome: ${mutationOutcomeText(string(summary.outcome))}`,
    );
    for (const resource of array(summary.resources) ?? []) {
      const value = record(resource);
      const identity = firstString(value.key, value.id, value.path, value.url);
      if (identity)
        lines.push(`${string(value.kind) || "resource"}: ${identity}`);
    }
    for (const warning of array(summary.warnings) ?? [])
      lines.push(`Warning: ${String(warning)}`);
    if (typeof summary.nextAction === "string")
      lines.push(`Next action: ${summary.nextAction}`);
    if (number(details.bytesWritten) !== undefined)
      lines.push(`Bytes written: ${String(details.bytesWritten)}`);
    if (number(details.operationCount) !== undefined)
      lines.push(`Operations: ${String(details.operationCount)}`);
    if (number(details.firstChangedLine) !== undefined)
      lines.push(`First changed line: ${String(details.firstChangedLine)}`);
  } else {
    const content = validContentBlocks(result)
      ?.filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (content && transitions.length === 0) lines.push(content);
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
      "operationCount",
      "firstChangedLine",
    ]);
    if (Object.keys(safe).length > 0) lines.push(formatFlat(safe));
  }
  const items = transitions.slice(0, 10).map((value, index) => ({
    id: String(index),
    countsAs: "item" as const,
    blocks: [
      { type: "text" as const, text: semanticSummary(value, index + 1) },
    ],
  }));
  if (items.length > 0) {
    lines.push(
      "Available transitions:",
      ...items.map((item) => textOf(item.blocks)),
    );
  }
  const text = lines.filter(Boolean).join("\n") || "Operation completed.";
  return {
    blocks: [{ type: "text", text }],
    status: [{ type: "text", text: lines.slice(0, 6).join("\n") }],
    ...(items.length > 0 ? { items, overflow: { noun: "transition" } } : {}),
    artifacts: artifacts(context),
  };
}

export function lifecycleCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const todos = array(result.todos) ?? array(details.todos);
  if (todos) {
    const items: SemanticItem[] = todos.map((value, index) => ({
      id: String(index),
      countsAs: "item",
      blocks: [
        {
          type: "text",
          text: `${index + 1}. ${record(value).done === true ? "[x]" : "[ ]"} ${string(record(value).todo)}`,
        },
      ],
    }));
    const title = `Todos: ${items.length}`;
    return {
      blocks: [
        {
          type: "text",
          text: [title, ...items.map((item) => textOf(item.blocks))].join("\n"),
        },
      ],
      status: [{ type: "text", text: title }],
      items,
      overflow: { noun: "todo" },
      counts: [count("item", items.length, items.length)],
      artifacts: artifacts(context),
    };
  }

  const values =
    array(result.tasks) ??
    array(details.tasks) ??
    (result.task && typeof result.task === "object"
      ? [result.task, ...(array(result.otherActiveTasks) ?? [])]
      : undefined);
  if (!values) return mutationCandidate(context);
  const control = record(result.result);
  const title =
    result.action === "stop"
      ? `Task control: stop — ${string(control.outcome) || "completed"}${string(control.message) ? ` — ${string(control.message)}` : ""}`
      : result.action === "restart"
        ? `Task control: restart — ${string(result.restartedFromTaskId)} → ${string(result.newTaskId)}`
        : `${values.length} task${values.length === 1 ? "" : "s"}`;
  const items: SemanticItem[] = values.map((value, index) => ({
    id: string(record(value).id) || String(index),
    countsAs: "task",
    blocks: [{ type: "text", text: taskSummary(value, index + 1) }],
  }));
  return {
    blocks: [
      {
        type: "text",
        text: [title, ...items.map((item) => textOf(item.blocks))].join("\n"),
      },
    ],
    status: [{ type: "text", text: title }],
    items,
    overflow: { noun: "task" },
    counts: [count("task", values.length, values.length)],
    artifacts: artifacts(context),
  };
}

export function resourceCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  if (Object.keys(details).length === 0) return textCandidate(context);
  const validated = artifacts(context);
  const core = stripArtifactLocations(
    pickSemantic(details, [
      "action",
      "issueKey",
      "projectKey",
      "boardId",
      "sprintId",
      "pageId",
      "spaceId",
      "spaceKey",
      "issue",
      "project",
      "board",
      "sprint",
      "page",
      "space",
      "bodyPreview",
      "webUrl",
      "bodyFormat",
    ]),
    validated,
  );
  const collections = [
    "comments",
    "transitions",
    "worklogs",
    "changelogEntries",
    "remoteLinks",
    "issueLinks",
    "attachments",
    "issueTypes",
    "fields",
    "sprints",
    "backlogIssues",
    "childPages",
    "footerComments",
    "inlineComments",
    "properties",
    "labels",
    "restrictions",
    "versions",
  ];
  const included = record(details.includedCounts);
  const relatedPages = new Map(
    (array(details.relatedCollections) ?? []).map((value) => [
      string(record(value).id),
      record(value),
    ]),
  );
  const coreText = semanticObjectText(core, 0);
  const statusLines = [coreText];
  const items: SemanticItem[] = [];
  let originalSections = 0;
  for (const name of collections) {
    const values = array(details[name]);
    const countKey = collectionCountKey(name);
    const original =
      number(relatedPages.get(collectionCountKey(name))?.original) ??
      number(included[countKey]) ??
      number(details[collectionDetailCountKey(name)]) ??
      number(details[`${singularName(name)}Count`]) ??
      number(details[`${name}Count`]) ??
      values?.length ??
      0;
    if (!values && original === 0) continue;
    const preview = (values ?? []).slice(0, 3);
    originalSections += 1;
    statusLines.push(
      `${name}: showing ${preview.length} of ${original}; ${Math.max(0, original - preview.length)} omitted.`,
    );
    if (preview.length > 0) {
      items.push({
        id: name,
        countsAs: "item",
        blocks: [
          {
            type: "text",
            text: [
              `${name}:`,
              ...preview.map((value, index) =>
                semanticSummary(value, index + 1),
              ),
            ].join("\n"),
          },
        ],
      });
    }
  }
  const relatedContinuation = relatedCollectionContinuations(details);
  for (const continuation of relatedContinuation) {
    if (continuation.kind === "cursor")
      statusLines.push(
        `Continue related collection with ${continuation.cursorName}=${String(continuation.value)}.`,
      );
  }
  const supportingLines = artifactNoticeLines(validated, "supporting_data");
  statusLines.push(...supportingLines);
  if (!coreText && items.length === 0 && supportingLines.length === 0)
    return textCandidate(context);
  const statusText = statusLines.filter(Boolean).join("\n");
  const blocks = [
    {
      type: "text" as const,
      text: [statusText, ...items.map((item) => textOf(item.blocks))]
        .filter(Boolean)
        .join("\n"),
    },
  ];
  return {
    blocks,
    status: [{ type: "text", text: statusText }],
    items,
    overflow: { noun: "related section" },
    counts: [count("item", originalSections, items.length)],
    continuation: [...continuations(details), ...relatedContinuation],
    artifacts: validated,
  };
}

export function webFetchCandidate(
  context: CandidateContext,
): ProjectionCandidate {
  const result = record(context.result);
  const details = record(result.details);
  const validated = artifacts(context);
  const primaryLines = artifactNoticeLines(validated, "primary_result");
  const body =
    primaryLines.length > 0
      ? primaryLines.join("\n")
      : typeof details.savedTo === "string"
        ? "Saved response artifact is unavailable for agent inspection."
        : typeof result.content === "string"
          ? result.content
          : fallbackText(result);
  const canonical = formatWebFetchCandidateText(details, body);
  const metadata = formatWebFetchCandidateText(details, "")
    .trimEnd()
    .split("\n\n")
    .filter(Boolean);
  return {
    blocks: [{ type: "text", text: canonical }],
    status: [
      {
        type: "text",
        text: [...metadata, ...primaryLines].join("\n"),
      },
    ],
    artifacts: validated,
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
  const validated = artifacts(context);
  const streamPaths = new Map<string, string>();
  for (const stream of ["stdout", "stderr"] as const) {
    const artifact = validated.find(
      (item) =>
        item.id === `task_${stream}` &&
        item.availability === "available" &&
        item.access.kind === "agent_file",
    );
    if (artifact?.access.kind === "agent_file") {
      streamPaths.set(stream, artifact.access.path);
    }
  }
  const shortenedStreams = new Set<string>();
  const items: SemanticItem[] = events.map((event, index) => {
    const value = record(event);
    const seq = number(value.seq) ?? index;
    const stream = string(value.stream) || "log";
    const raw = record(value.raw);
    const path = streamPaths.get(stream);
    const start = number(raw.start);
    const end = number(raw.end);
    const prefix = `${seq} [${stream}] `;
    const recoverySuffix =
      path && start !== undefined && end !== undefined
        ? ` [${stream} bytes ${String(start)}-${String(end)}]`
        : "";
    const originalLine = string(value.line);
    const maxPlainBytes = Math.max(0, 512 - Buffer.byteLength(prefix, "utf8"));
    const needsShortening =
      recoverySuffix.length > 0 &&
      Buffer.byteLength(originalLine, "utf8") > maxPlainBytes;
    const maxPayloadBytes = Math.max(
      0,
      512 - Buffer.byteLength(prefix + recoverySuffix, "utf8"),
    );
    const displayedLine = needsShortening
      ? maxPayloadBytes >= 3
        ? `${textHead(originalLine, maxPayloadBytes - 3, 1)}…`
        : ""
      : originalLine;
    if (needsShortening) shortenedStreams.add(stream);
    return {
      id: String(seq),
      countsAs: "event",
      blocks: [
        {
          type: "text",
          text: `${prefix}${displayedLine}${needsShortening ? recoverySuffix : ""}`,
        },
      ],
    };
  });
  const originalEventCount =
    number(response.originalEventCount) ??
    number(response.total) ??
    events.length;
  const task = record(response.task);
  const mode = string(response.mode) || "recent";
  const statusText = [
    `Task logs: ${mode}`,
    Object.keys(task).length > 0
      ? taskSummary(task, 1).replace(/^1\. /, "")
      : undefined,
    ...[...shortenedStreams].map((stream) =>
      streamPaths.has(stream)
        ? `${stream} recovery: ${streamPaths.get(stream)}`
        : undefined,
    ),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const eventText = items.map((item) => textOf(item.blocks)).join("\n");
  const firstSeq = number(response.firstSeq) ?? number(record(events[0]).seq);
  const lastSeq =
    number(response.lastSeq) ?? number(record(events.at(-1)).seq) ?? firstSeq;
  const canonicalNotice = [
    firstSeq !== undefined && lastSeq !== undefined
      ? `Showing ${events.length} of ${originalEventCount} events (seq ${firstSeq}-${lastSeq}); ${Math.max(0, originalEventCount - events.length)} omitted.`
      : `Showing ${events.length} of ${originalEventCount} events.`,
    response.hasMoreBefore === true && firstSeq !== undefined
      ? `For older events, call task_logs in ${mode} mode with cursor=${firstSeq}.`
      : undefined,
    lastSeq !== undefined
      ? `For future events, use mode=since_cursor with cursor=${lastSeq}.`
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const failure = events.find((event) => record(event).level === "error");
  const failureSeq = failure ? number(record(failure).seq) : undefined;
  return {
    blocks: [
      {
        type: "text",
        text: [statusText, eventText, canonicalNotice]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    status: [{ type: "text", text: statusText }],
    items,
    overflow: { noun: "event" },
    continuation: continuations(response),
    taskLog: {
      mode,
      ...(failureSeq !== undefined ? { failureSeq } : {}),
      originalEventCount,
      hasMoreBefore: response.hasMoreBefore === true,
      hasMoreAfter: response.hasMoreAfter === true,
      eventsArtifactId: "task_events",
    },
    counts: [count("event", originalEventCount, events.length)],
    artifacts: validated,
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
  const result = record(context.result);
  const details = record(result.details);
  const metadata = pickSemantic(details, [
    "action",
    "attachmentId",
    "filename",
    "mediaType",
    "bytes",
    "bodyFormat",
    "pageCount",
    "displayedPageCount",
    "attachmentCount",
    "downloadDir",
  ]);
  const included = record(details.includedCounts);
  const extra =
    number(included.downloadedAttachments) !== undefined
      ? `downloadedAttachments: ${String(included.downloadedAttachments)}`
      : "";
  const lines = [
    formatFlat(metadata),
    extra,
    ...artifactNoticeLines(artifacts(context), "primary_result"),
  ].filter(Boolean);
  const text = lines.join("\n") || fallbackText(context.result);
  return {
    blocks: [{ type: "text", text }],
    status: [{ type: "text", text }],
    artifacts: artifacts(context),
  };
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

function taskSummary(value: unknown, index: number): string {
  const task = record(value);
  const readiness = record(task.readiness);
  const parts = [
    `${index}. name: ${string(task.name) || "task"}`,
    `id: ${string(task.id) || "unknown"}`,
    `status: ${string(task.status) || "unknown"}`,
    typeof readiness.outcome === "string"
      ? `readiness: ${readiness.outcome}`
      : undefined,
    number(task.exitCode) !== undefined
      ? `exit: ${String(task.exitCode)}`
      : undefined,
    typeof task.signal === "string" ? `signal: ${task.signal}` : undefined,
    typeof task.finishedAt === "string"
      ? `finished: ${task.finishedAt}`
      : undefined,
    typeof task.error === "string" ? `error: ${task.error}` : undefined,
    typeof task.restartedFromTaskId === "string"
      ? `restarted from: ${task.restartedFromTaskId}`
      : undefined,
    typeof task.restartRootTaskId === "string" &&
    task.restartRootTaskId !== task.id
      ? `restart root: ${task.restartRootTaskId}`
      : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

function mutationOutcomeText(outcome: string): string {
  if (outcome === "dry_run") return "dry run; operation not performed";
  if (outcome === "partial") return "partially succeeded";
  if (outcome === "succeeded") return "succeeded";
  return outcome || "completed";
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
      cursorName: "cursor",
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

function continuationText(continuation: ExactContinuation): string {
  switch (continuation.kind) {
    case "line":
      return `Continue with offset=${continuation.nextOffset}.`;
    case "byte":
      return `Continue with byteOffset=${continuation.nextByteOffset}.`;
    case "cursor":
      return `Continue with ${continuation.cursorName}=${String(continuation.value)}.`;
    case "page_token":
      return `Continue with ${continuation.parameter}=${continuation.value}.`;
  }
}

function relatedCollectionContinuations(
  details: Record<string, unknown>,
): ExactContinuation[] {
  const pages = array(details.relatedCollections) ?? [];
  return pages.flatMap((value) => {
    const page = record(value);
    const continuation = record(page.continuation);
    if (
      typeof continuation.parameter !== "string" ||
      (typeof continuation.value !== "string" &&
        typeof continuation.value !== "number")
    )
      return [];
    return [
      {
        kind: "cursor" as const,
        cursorName: continuation.parameter,
        value: continuation.value,
        direction:
          continuation.direction === "before"
            ? ("before" as const)
            : ("after" as const),
      },
    ];
  });
}

function stripArtifactLocations(
  value: unknown,
  artifacts: readonly ValidatedToolArtifact[],
): Record<string, unknown> {
  const locations = new Set(
    artifacts.flatMap((artifact) => {
      if (artifact.access.kind === "agent_file") return [artifact.access.path];
      if (artifact.access.kind === "metadata_only" && artifact.access.location)
        return [artifact.access.location];
      return [];
    }),
  );
  const visit = (input: unknown): unknown => {
    if (typeof input === "string")
      return locations.has(input) ? undefined : input;
    if (Array.isArray(input))
      return input.map(visit).filter((item) => item !== undefined);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .map(([key, nested]) => [key, visit(nested)] as const)
        .filter((entry) => entry[1] !== undefined),
    );
  };
  return record(visit(value));
}

function artifactNoticeLines(
  values: readonly ValidatedToolArtifact[],
  role?: ValidatedToolArtifact["role"],
): string[] {
  return values
    .filter(
      (artifact) =>
        artifact.availability === "available" &&
        (!role || artifact.role === role),
    )
    .map((artifact) => {
      if (artifact.access.kind === "agent_file") {
        const tool = artifact.recommendedTools[0];
        return `${artifact.label}: ${artifact.access.path}${tool ? ` (use ${tool})` : ""}`;
      }
      if (
        role === "primary_result" &&
        artifact.access.kind === "metadata_only" &&
        artifact.access.location
      )
        return `${artifact.label}: ${artifact.access.location} (metadata only)`;
      return "";
    })
    .filter(Boolean);
}

function collectionCountKey(name: string): string {
  const aliases: Record<string, string> = {
    changelogEntries: "changelog",
    childPages: "directChildren",
    backlogIssues: "backlogIssues",
  };
  return aliases[name] ?? name;
}

function collectionDetailCountKey(name: string): string {
  const aliases: Record<string, string> = {
    changelogEntries: "displayedChangelogCount",
    childPages: "displayedChildPageCount",
    backlogIssues: "backlogCount",
  };
  return aliases[name] ?? `${singularName(name)}Count`;
}

function singularName(name: string): string {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (name.endsWith("s")) return name.slice(0, -1);
  return name;
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
      "content",
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
function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
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
