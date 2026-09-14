import { createHash } from "node:crypto";
import type { PermissionRule } from "@nervekit/contracts/permissions";

export function policyFailureFingerprint(input: {
  selectedRuleSetId: string;
  diagnostics: string[];
}): string {
  return policyDigestJson({
    selectedRuleSetId: input.selectedRuleSetId,
    diagnostics: input.diagnostics,
  });
}

export function fallbackConfirmationFingerprint(input: {
  diagnosticId: string;
  failureFingerprint: string;
  requestedRuleSetId: string;
}): string {
  return policyDigestJson(input);
}

export function policyDigestJson(value: unknown): string {
  return digestContent(JSON.stringify(value));
}

export function digestContent(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function canonicalPermissionMatcher(rule: PermissionRule): string {
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
