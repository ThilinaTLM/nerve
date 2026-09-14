import type {
  PermissionOverlay,
  PermissionOverlayOrigin,
  PermissionRule,
} from "@nervekit/contracts/permissions";
import { permissionOverlayForOriginSchema } from "@nervekit/contracts/permissions";

export function saveRuleInOverlay(
  base: PermissionOverlay,
  rule: PermissionRule,
  origin: PermissionOverlayOrigin,
): PermissionOverlay {
  const canonical = canonicalMatcher(rule);
  const duplicate = base.rules.findIndex(
    (candidate) =>
      candidate.enforcement === rule.enforcement &&
      canonicalMatcher(candidate) === canonical,
  );
  let remaining = base.rules.filter((_, index) => index !== duplicate);
  const desiredEnforcement =
    origin === "user" ? rule.enforcement : "overridable";
  const sameClass = remaining.filter(
    (candidate) => candidate.enforcement === desiredEnforcement,
  );
  let priority =
    Math.max(-1_000, ...sameClass.map((item) => item.priority), -1) + 1;
  if (priority > 1_000) {
    const ordered = [...sameClass].sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id),
    );
    const normalized = new Map(
      ordered.map((candidate, index) => [candidate.id, -1_000 + index]),
    );
    remaining = remaining.map((candidate) => ({
      ...candidate,
      priority: normalized.get(candidate.id) ?? candidate.priority,
    }));
    priority = -1_000 + ordered.length;
  }
  return permissionOverlayForOriginSchema(origin).parse({
    ruleSetId: base.ruleSetId,
    rules: [
      ...remaining,
      { ...rule, priority, enforcement: desiredEnforcement },
    ],
  });
}

function canonicalMatcher(rule: PermissionRule): string {
  return JSON.stringify({
    enforcement: rule.enforcement,
    when: sort(rule.when),
  });
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sort(child)]),
    );
  }
  return value;
}
