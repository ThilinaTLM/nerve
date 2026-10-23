import { createHash } from "node:crypto";
import type { Supervision } from "@nervekit/contracts/core";
import type {
  ExecutionAdmissionInput,
  PermissionPort,
  ToolHostPort,
} from "../ports.js";

export interface TestPermissionPort extends PermissionPort {
  evaluate(
    input: ExecutionAdmissionInput & { ruleSetId: string },
  ): Promise<Supervision>;
}

/** Test-only execution authority for runtime fixtures, not a production policy source. */
export function withTestAdmission(
  port: TestPermissionPort,
  ruleSet: (id: string) => string = () => "baseline",
): TestPermissionPort {
  const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const result: TestPermissionPort = {
    ...port,
    async prepareAdmission(input) {
      const supervision = await result.evaluate({
        ...input,
        ruleSetId: ruleSet(input.conversationId),
      });
      return {
        check: () => ({
          kind: "policy",
          supervision,
          evidence: {
            binding: {
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              argumentsDigest: digest(input.args),
              executionTargetDigest: digest({
                target: input.target,
                cwd: input.cwd,
              }),
              policyAuthorityDigest: digest(supervision.authority),
            },
            requestGenerations: {},
            policyGenerations: { test: 1 },
          },
        }),
      };
    },
  };
  return result;
}
export function withTestPreparation(port: ToolHostPort): ToolHostPort {
  const result: ToolHostPort = {
    ...port,
    prepareExecution:
      port.prepareExecution ??
      (async (input) => ({
        args: input.args,
        cwd: input.cwd,
        target: {},
        dispatch: () => result.execute(input),
      })),
  };
  return result;
}
