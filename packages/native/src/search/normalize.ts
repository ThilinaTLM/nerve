import type { NativeSearchField } from "./binding.js";
import type { SearchField } from "./contracts.js";

const nonAscii = /\P{ASCII}/u;
function stem(name: string, directory: boolean): string {
  return !directory && name.includes(".")
    ? name.slice(0, name.lastIndexOf("."))
    : name;
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
    const lowerSegments = segments.map((segment) => segment.toLowerCase());
    const derivedSegments = result.lower.split("/");
    if (lowerSegments.some((segment, i) => segment !== derivedSegments[i]))
      result.segmentsLower = lowerSegments;
    const nameLower = name.toLowerCase();
    if (nameLower !== lowerSegments.at(-1)) result.nameLower = nameLower;
    const stemLower = stem(name, field.text.endsWith("/")).toLowerCase();
    if (stemLower !== stem(nameLower, field.text.endsWith("/")))
      result.stemLower = stemLower;
  }
  return result;
}
