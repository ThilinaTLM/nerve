import { isAbsolute } from "node:path";
import type { CompletionItem } from "@nervekit/contracts/completions";
import type { FileCompletionCandidate } from "./file-completion-candidates.js";

export type CompletionItemInput = {
  candidate: FileCompletionCandidate;
  score: number;
  matchRanges: Array<[number, number]>;
};

export function isUnsafeCompletionQuery(query: string): boolean {
  if (!query) return false;
  if (
    query.startsWith("/") ||
    query.startsWith("//") ||
    /^[A-Za-z]:\//.test(query) ||
    isAbsolute(query)
  ) {
    return true;
  }
  return query.split("/").some((segment) => segment === "..");
}

export function toCompletionItem({
  candidate,
  score,
  matchRanges,
}: CompletionItemInput): CompletionItem {
  const label = labelFor(candidate);
  const kindLabel = candidate.kind === "directory" ? "folder" : "file";
  const parent = candidate.parentPath || "project root";
  return {
    label,
    displayLabel: label,
    apply: label,
    detail: `${kindLabel} · ${parent}`,
    info: candidate.relativePath,
    kind: candidate.kind,
    sortScore: Math.round(score),
    matchRanges,
  };
}

function labelFor(candidate: FileCompletionCandidate): string {
  return `@${candidate.relativePath}${candidate.kind === "directory" ? "/" : ""}`;
}

export function labelNameOffset(candidate: FileCompletionCandidate): number {
  return 1 + candidate.relativePath.length - candidate.name.length;
}
