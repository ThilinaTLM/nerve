import type {
  CandidateContext,
  ProjectionCandidate,
  SemanticItem,
} from "../types.js";
import { textCandidate } from "./text.js";
import { artifacts, artifactNoticeLines } from "../candidate-artifacts.js";
import { continuations, continuationText } from "../candidate-continuation.js";
import { semanticSummary } from "../candidate-semantic-text.js";
import {
  count,
  textOf,
  record,
  array,
  firstNumber,
  firstString,
} from "../candidate-values.js";

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
