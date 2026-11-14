import { nameOf } from "./format.js";

export function matchTransition(
  transitions: unknown[],
  query: string,
): unknown | undefined {
  const normalized = normalize(query);
  return transitions.find((transition) => {
    if (!transition || typeof transition !== "object") return false;
    const record = transition as Record<string, unknown>;
    const id = String(record.id ?? "");
    const name = typeof record.name === "string" ? record.name : "";
    const to = nameOf(record.to) ?? "";
    return (
      id === query ||
      normalize(name) === normalized ||
      normalize(to) === normalized
    );
  });
}

export function transitionSummary(
  transition: unknown,
): Record<string, unknown> {
  if (!transition || typeof transition !== "object")
    return { value: transition };
  const record = transition as Record<string, unknown>;
  return { id: record.id, name: record.name, to: nameOf(record.to) };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
