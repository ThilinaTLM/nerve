import type { ProjectionCount } from "@nervekit/contracts/tools";
import type { ProjectableBlock } from "./types.js";

export function count(
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

export function textOf(blocks: readonly ProjectableBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function array(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}
