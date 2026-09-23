import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { initializeStorage } from "../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../src/app/runtime/server-runtime.js";
import { createRuntimeFixture } from "./runtime-fixture.js";

type Stage =
  | "decision"
  | "release"
  | "lease"
  | "claim"
  | "effect"
  | "result"
  | "append"
  | "settlement";
type Command =
  | { op: "decide"; index: number; requestId: string }
  | { op: "snapshot" }
  | { op: "stop" };
const [mode, home, workspace, countText, stage] = process.argv.slice(2) as [
  "setup" | "recover",
  string,
  string,
  string,
  Stage,
];
const count = Number(countText);
const provider = "nerve-process-checkpoint";
const marker = join(workspace, "effects.log");
const send = (message: unknown) => process.send?.(message);
const hold = (name: Stage, detail?: unknown) => {
  if (stage !== name) return;
  send({ event: "barrier", name, detail });
  return new Promise<never>(() => {});
};

async function main() {
  await mkdir(workspace, { recursive: true });
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [
      {
        type: "toolCalls",
        calls: Array.from({ length: count }, (_, index) => ({
          id: `process_call_${index}`,
          name: "bash",
          args: { command: `printf '%s\\n' '${index}' >> '${marker}'` },
        })),
      },
      { type: "assistantText", text: "All approved writes finished." },
    ],
  });
  const fixture = createRuntimeFixture(
    await initializeStorage(home),
    "127.0.0.1",
    0,
  );
  const { services, runtime } = fixture;
  const patchAfter = <T extends object, K extends keyof T>(
    object: T,
    key: K,
    barrier: Stage,
    match: (...args: unknown[]) => boolean = () => true,
  ) => {
    const original = object[key] as (...args: unknown[]) => Promise<unknown>;
    (object as Record<K, unknown>)[key] = async (...args: unknown[]) => {
      const result = await original.apply(object, args);
      if (match(...args))
        await hold(barrier, {
          id: (result as { id?: string } | undefined)?.id,
        });
      return result;
    };
  };
  if (mode === "setup") {
    if (stage === "decision" || stage === "release") {
      const original = services.workbenchRun.recordApprovalDecision.bind(
        services.workbenchRun,
      );
      services.workbenchRun.recordApprovalDecision = async (...args) => {
        const result = await original(...args);
        if (
          stage === "decision"
            ? result.run.status === "waiting"
            : result.run.status === "executing_tools"
        )
          await hold(stage);
        return result;
      };
    }
    if (stage === "lease") {
      const original = runtime.canonicalStore.claimLifecycleWork.bind(
        runtime.canonicalStore,
      );
      runtime.canonicalStore.claimLifecycleWork = async (input) => {
        const result = await original(input);
        if (result?.kind === "execute_tool") await hold("lease");
        return result;
      };
    }
    if (stage === "claim")
      patchAfter(services.tools, "claimApprovedExecution", stage);
    if (stage === "result") patchAfter(services.tools, "executeClaimed", stage);
    if (stage === "effect") {
      // Hold after the actual external command returns but before tool result persistence.
      const executor = (
        services.tools as unknown as {
          executor: {
            deps: {
              dispatcher: { execute: (...args: unknown[]) => Promise<unknown> };
            };
          };
        }
      ).executor;
      patchAfter(executor.deps.dispatcher, "execute", stage);
    }
    if (stage === "append") {
      const approvals = (
        services.humanInput as unknown as {
          approvals: {
            deps: {
              appendToolResult: (...args: unknown[]) => Promise<unknown>;
            };
          };
        }
      ).approvals;
      patchAfter(approvals.deps, "appendToolResult", stage);
    }
    if (stage === "settlement") {
      const unit = services.runRuntime.unitOfWork;
      const original = unit.commit.bind(unit);
      unit.commit = async (...args) => {
        const result = await original(...args);
        if (args[1].kind === "approval_checkpoint_settled")
          await hold("settlement");
        return result;
      };
    }
  }
  await fixture.lifecycle.hydrate();
  let conversationId: string;
  let agentId: string;
  if (mode === "setup") {
    const project = await services.projectLifecycle.createProject({
      dir: workspace,
    });
    const conversation =
      await services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const agent = await services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: { provider, modelId: "scripted-fast" },
      permissionLevel: "supervised",
      permissionRuleSetId: "supervised",
    });
    conversationId = conversation.id;
    agentId = agent.id;
    await services.workbenchRun.promptAgent(agent.id, {
      text: "Append one line per approved tool.",
    });
  } else {
    const agent = services.agentLifecycle
      .listAgents()
      .find((item) => item.model.provider === provider);
    if (!agent) throw new Error("Recovered agent not found");
    agentId = agent.id;
    conversationId = agent.conversationId;
  }
  async function snapshot() {
    const run = (await services.runRuntime.unitOfWork.listMetadata()).find(
      (item) => item.conversationId === conversationId,
    );
    const state = run
      ? await services.runRuntime.unitOfWork.loadFresh(run.runId)
      : undefined;
    const work = run
      ? await runtime.canonicalStore.listLifecycleWorkForRun(run.runId)
      : [];
    const tools = state?.interactions.length
      ? await Promise.all(
          state.interactions.map((item) =>
            services.tools.getToolCallDetails(item.toolCallId),
          ),
        )
      : services.tools
          .listToolCalls()
          .filter((tool) => tool.conversationId === conversationId);
    const entries =
      services.conversationLifecycle.getConversationEntries(conversationId);
    const effects = await readFile(marker, "utf8").catch(() => "");
    return {
      agent: services.agentLifecycle.getAgent(agentId).status,
      run: state?.run.status,
      interactions: state?.interactions.map((item) => item.status),
      transitions: state?.transitions.map((item) => item.kind),
      tools: tools.map((tool) => ({
        id: tool.id,
        status: tool.status,
        attempt: tool.attempt,
        revision: tool.revision,
        error: tool.error,
      })),
      work: work.map((item) => ({
        kind: item.kind,
        state: item.state,
        generation: item.generation,
        failurePhase: item.failurePhase,
        proposalId: item.proposalId,
      })),
      issues: await runtime.canonicalStore.listRecoveryIssues(conversationId),
      results: entries
        .map(
          (entry) =>
            (entry.details as { toolRecordId?: string } | undefined)
              ?.toolRecordId,
        )
        .filter(Boolean),
      effects: effects.trim() ? effects.trim().split("\n") : [],
    };
  }
  // The child stays alive at IPC barriers; the parent owns SIGKILL and reaping.
  process.on("message", (command: Command) => {
    void (async () => {
      if (command.op === "snapshot")
        send({ event: "snapshot", state: await snapshot() });
      if (command.op === "decide") {
        const approvals = services.tools
          .listApprovals("pending")
          .filter((item) => item.conversationId === conversationId);
        const target = services.tools
          .listToolCalls()
          .filter((tool) => tool.conversationId === conversationId)[
          command.index
        ];
        if (
          !target ||
          (mode === "setup" &&
            !approvals.some((item) => item.toolCallId === target.id))
        )
          throw new Error(`Approval ${command.index} missing`);
        const receipt = await services.toolInteractions.resolve({
          toolCallId: target.id,
          interactionOrdinal: 0,
          expectedRevision: target.revision,
          resolutionRequestId: command.requestId,
          resolution: { kind: "approval", action: "allow" },
        });
        send({
          event: "decided",
          receipt: {
            status: receipt.toolCall.status,
            checkpoint: receipt.checkpoint,
          },
        });
      }
      if (command.op === "stop") {
        await shutdownServerRuntime(runtime);
        registration.unregister();
        process.exit(0);
      }
    })().catch((error) =>
      send({ event: "error", error: String(error?.stack ?? error) }),
    );
  });
  if (mode === "setup") {
    const deadline = Date.now() + 10_000;
    while (
      services.tools
        .listApprovals("pending")
        .filter((item) => item.conversationId === conversationId).length !==
      count
    ) {
      if (Date.now() > deadline)
        throw new Error(
          `Timed out waiting for ${count} approvals: ${JSON.stringify(await snapshot())}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  send({ event: "ready", state: await snapshot() });
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
