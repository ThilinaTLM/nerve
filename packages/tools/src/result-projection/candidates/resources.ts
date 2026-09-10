import type {
  CandidateContext,
  ProjectionCandidate,
  SemanticItem,
} from "../types.js";
import { textCandidate } from "./text.js";
import {
  artifacts,
  stripArtifactLocations,
  artifactNoticeLines,
} from "../candidate-artifacts.js";
import {
  continuations,
  relatedCollectionContinuations,
} from "../candidate-continuation.js";
import {
  semanticSummary,
  semanticObjectText,
  pickSemantic,
} from "../candidate-semantic-text.js";
import {
  count,
  textOf,
  record,
  array,
  string,
  number,
} from "../candidate-values.js";

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
