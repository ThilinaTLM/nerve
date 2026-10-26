import { createHash } from "node:crypto";
import type { PermissionPort } from "@nervekit/conversation-core";
import type {
  ConfigurationBlockedRequest,
  ConfigurationGenerationVector,
  Supervision,
} from "@nervekit/contracts/core";

type Input = Parameters<NonNullable<PermissionPort["prepareAdmission"]>>[0];

/** Canonical JSON only. Callers must supply validated, non-secret execution material. */
export function canonicalDigest(value: unknown): string {
  function encode(node: unknown): string {
    if (node === null || typeof node === "string" || typeof node === "boolean")
      return JSON.stringify(node);
    if (typeof node === "number" && Number.isFinite(node))
      return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(encode).join(",")}]`;
    if (
      typeof node === "object" &&
      node &&
      Object.getPrototypeOf(node) === Object.prototype
    )
      return `{${Object.keys(node)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${encode((node as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
    throw new Error("Admission identity must be canonical JSON");
  }
  return createHash("sha256").update(encode(value)).digest("hex");
}

export type CurrentPolicy =
  | { kind: "stale" }
  | { kind: "blocked"; request: ConfigurationBlockedRequest }
  | {
      kind: "available";
      generations: ConfigurationGenerationVector;
      /** Durable authority, including ruleset, exact policy/trust and role restrictions. */
      authority: unknown;
      child: boolean;
      evaluate(input: Input): Supervision;
    };

export interface AdmissionPolicySource {
  /** Synchronously fence loaded policies after save/trust publication, before acknowledgement.
   * current() must return stale/blocked until ensureLoaded publishes validated replacements. */
  invalidate(): void;
  /** Loads dependencies once, or refreshes explicitly invalidated dependencies; never polls files. */
  ensureLoaded(input: Input): Promise<void>;
  /** Always reads CURRENT validated memory, not the snapshot from ensureLoaded. */
  current(input: Input): CurrentPolicy;
  requestGenerations(input: Input): ConfigurationGenerationVector;
}

export function createExecutionAdmission(
  source: AdmissionPolicySource,
): NonNullable<PermissionPort["prepareAdmission"]> {
  return async (input) => {
    // Freeze identity before asynchronous loading; callers cannot mutate prepared material.
    const identity = structuredClone(input);
    const argumentsDigest = canonicalDigest(identity.args);
    const executionTargetDigest = canonicalDigest({
      target: identity.target,
      cwd: identity.cwd,
    });
    await source.ensureLoaded(identity);
    return {
      check() {
        const current = source.current(identity);
        if (current.kind !== "available") return current;
        const childBan =
          current.child &&
          (identity.toolName === "ask_user" ||
            identity.toolName === "plan_present" ||
            identity.toolName.startsWith("subagent_"));
        const supervision: Supervision = childBan
          ? {
              decision: "deny",
              suggestedRules: [],
              authority: {},
              reason:
                "Child agents cannot ask users, present plans, or delegate/manage sub-agents.",
            }
          : current.evaluate(identity);
        const latest = source.current(identity);
        if (latest.kind !== "available") return latest;
        if (
          canonicalDigest(latest.generations) !==
          canonicalDigest(current.generations)
        )
          return { kind: "stale" };
        return {
          kind: "policy",
          supervision,
          evidence: {
            binding: {
              toolCallId: identity.toolCallId,
              toolName: identity.toolName,
              argumentsDigest,
              executionTargetDigest,
              policyAuthorityDigest: canonicalDigest({
                authority: current.authority,
                child: current.child,
              }),
            },
            requestGenerations: source.requestGenerations(identity),
            policyGenerations: { ...current.generations },
          },
        };
      },
    };
  };
}
