import type { FileCompletionCandidateInput } from "./file-completion-index.js";
import type {
  NativeCompletionCandidate,
  NativeSearchField,
} from "./binding.js";
import type { SearchField } from "./contracts.js";

const nonAscii = /\P{ASCII}/u;
function stem(name: string, directory: boolean): string {
  return !directory && name.includes(".")
    ? name.slice(0, name.lastIndexOf("."))
    : name;
}

/** Host casing only where needed for exact ECMAScript Unicode behavior. */
export function compactCandidate(
  c: FileCompletionCandidateInput,
  localeRank: number,
): NativeCompletionCandidate {
  const directory = c.kind === "directory";
  const result: NativeCompletionCandidate = {
    path: c.relativePath,
    directory,
    localeRank,
    depth: c.depth,
  };
  const expectedName = c.relativePath.slice(
    c.relativePath.lastIndexOf("/") + 1,
  );
  const customSegments =
    c.segments.length === 0 ||
    c.segments.some((s) => s.includes("/")) ||
    c.segments.join("/") !== c.relativePath;
  if (customSegments) result.segments = [...c.segments];
  if (c.name !== (customSegments ? c.segments.at(-1) : expectedName))
    result.name = c.name;
  if (c.stem !== stem(c.name, directory)) result.stem = c.stem;
  if (
    nonAscii.test(c.relativePath) ||
    customSegments ||
    result.name !== undefined ||
    result.stem !== undefined
  ) {
    const lower = c.relativePath.toLowerCase();
    if (nonAscii.test(c.relativePath)) result.pathLower = lower;
    const derivedSegments = lower.split("/");
    const lowerSegments = c.segments.map((s) => s.toLowerCase());
    if (
      customSegments ||
      lowerSegments.some((s, i) => s !== derivedSegments[i])
    )
      result.segmentsLower = lowerSegments;
    const nameLower = c.name.toLowerCase();
    if (nameLower !== lowerSegments.at(-1)) result.nameLower = nameLower;
    const stemLower = c.stem.toLowerCase();
    if (stemLower !== stem(nameLower, directory)) result.stemLower = stemLower;
  }
  return result;
}

/** Sparse offset metadata is needed only for length-changing ECMAScript casing. */
export function caseAlignment(
  value: string,
  lower: string,
): { aligned: string; caseSpans: number[][] } | undefined {
  if (value.length === lower.length) return undefined;
  const parts: string[] = [];
  const caseSpans: number[][] = [];
  let original = 0,
    normalized = 0;
  for (const char of value) {
    const width = char.toLowerCase().length;
    if (char.length !== width)
      caseSpans.push([original, normalized, char.length, width]);
    parts.push(
      char.length === width
        ? char
        : char.padEnd(width, char.at(-1)!).slice(0, width),
    );
    original += char.length;
    normalized += width;
  }
  return { aligned: parts.join(""), caseSpans };
}

export function compactField(field: SearchField): NativeSearchField {
  const result: NativeSearchField = { key: field.key, text: field.text };
  if (!nonAscii.test(field.text)) return result;
  result.lower = field.text.toLowerCase();
  Object.assign(result, caseAlignment(field.text, result.lower));
  if (field.key === "path") {
    const segments = field.text.split("/");
    const name = segments.at(-1)!;
    const compact = compactCandidate(
      {
        relativePath: field.text,
        name,
        stem: stem(name, field.text.endsWith("/")),
        segments,
        depth: segments.length,
        kind: field.text.endsWith("/") ? "directory" : "file",
      },
      0,
    );
    if (compact.nameLower !== undefined) result.nameLower = compact.nameLower;
    if (compact.stemLower !== undefined) result.stemLower = compact.stemLower;
    if (compact.segmentsLower !== undefined)
      result.segmentsLower = compact.segmentsLower;
  }
  return result;
}
