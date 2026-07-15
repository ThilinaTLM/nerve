import assert from "node:assert/strict";
import test from "node:test";
import type { ToolName } from "@nervekit/contracts";
import {
  createHostToolFactory,
  type HostToolExecutionRequest,
} from "../src/tools.js";

type Request = HostToolExecutionRequest & {
  toolName: ToolName;
  cwd: string;
  identity: { conversationId: string; agentId: string };
};

test("shared host tool factory composes context, handlers, policy, overrides, and lifecycle", async () => {
  const lifecycle: string[] = [];
  const factory = createHostToolFactory<Request>({
    execution: { context: (request) => ({ cwd: request.cwd }) },
    handlers: {
      forExecution: () => ({
        task_status: async (_args, context) => ({
          content: `${context.cwd}:${String(
            (context.identity as Request["identity"]).conversationId,
          )}`,
        }),
      }),
    },
    policy: {
      authorize: (_request, _name, args) => ({
        decision: args.denied ? "deny" : "allow",
        risk: "read",
        reason: args.denied ? "denied by host" : "allowed",
        normalizedArgs: args,
      }),
    },
    lifecycle: {
      forExecution: () => ({
        requested: () => void lifecycle.push("requested"),
        started: () => void lifecycle.push("started"),
        completed: () => void lifecycle.push("completed"),
      }),
    },
  });
  const request: Request = {
    toolName: "task_status",
    cwd: "/workspace",
    identity: { conversationId: "conv_contract", agentId: "agent_main" },
  };
  assert.deepEqual(await factory.execute(request, {}), {
    content: "/workspace:conv_contract",
  });
  assert.deepEqual(lifecycle, ["requested", "started", "completed"]);
  await assert.rejects(() => factory.execute(request, { denied: true }), {
    code: "TOOL_DENIED",
  });
});
