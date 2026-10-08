import type { WorkbenchAgentControls } from "../../../src/domains/runs/application/workbench-run.service.js";
import type { RunPromptRecord } from "@nervekit/contracts/runs";
import { WorkbenchRunService } from "../../../src/domains/runs/application/workbench-run.service.js";
import {
  AgentInputService,
  type AgentInputQueueState,
} from "../../../src/domains/runs/runtime/agent-inputs.js";
export function fixture(options: Partial<WorkbenchAgentControls> = {}) {
  const agent = {
    id: "agent_child",
    conversationId: "conv_shared",
    projectId: "proj_test",
    parentAgentId: "agent_parent",
    activationState: "enabled",
  };
  const documents = new Map<string, AgentInputQueueState>();
  let sequence = 0;
  const inputs = new AgentInputService(
    {
      load: async (id) => structuredClone(documents.get(id)),
      save: async (id, document) => {
        documents.set(id, structuredClone(document));
      },
    },
    { next: () => String(++sequence) },
    { now: () => new Date() },
  );
  const runs = new Map<
    string,
    {
      prompts?: RunPromptRecord[];
      run: {
        runId: string;
        agentId: string;
        conversationId: string;
        projectId: string;
        scopeId: string;
        executionId: string;
        status: string;
        updatedAt: string;
        terminalAt?: string;
        initialInputId?: string;
      };
    }
  >();
  const starts: string[] = [];
  const commandPrompts: Array<string | undefined> = [];
  const continues: string[] = [];
  let beforeStart: (() => Promise<void>) | undefined;
  let settledForAgent = async () => undefined;
  let beforeRunControl: (() => Promise<void>) | undefined;
  let beforeFindActive: (() => void) | undefined;
  const start = async (
    command: {
      assertAdmission?: () => Promise<void>;
      runId?: string;
      initialInputId?: string;
      prompt?: string;
    } = {},
  ) => {
    await beforeStart?.();
    await command.assertAdmission?.();
    const runId = command.runId ?? `run_${starts.length + 1}`;
    starts.push(runId);
    commandPrompts.push(command.prompt);
    const run = {
      runId,
      initialInputId: command.initialInputId,
      agentId: agent.id,
      conversationId: agent.conversationId,
      projectId: agent.projectId,
      scopeId: `${agent.conversationId}:${agent.id}`,
      executionId: `exec_${starts.length}`,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
    runs.set(runId, { run });
    return run;
  };
  const service = new WorkbenchRunService(
    {
      agents: new Map([[agent.id, agent]]),
      getConversation: () => ({
        id: agent.conversationId,
        activeEntryId: "entry_root_leaf",
      }),
      maintenanceScopes: { assertConversation() {}, assertProject() {} },
    } as never,
    {
      withRunControlFence: async (
        _runId: string,
        action: () => Promise<unknown>,
      ) => {
        await beforeRunControl?.();
        return action();
      },
      start: start,
      startContinuation: start,
      settledForAgent: () => settledForAgent(),
      cancelPrompt: async (runId: string, promptId: string) => {
        const prompt = runs
          .get(runId)
          ?.prompts?.find((item) => item.id === promptId);
        if (prompt) prompt.status = "cancelled";
      },
      cancel: async (runId: string) => {
        runs.get(runId)!.run.status = "cancelled";
      },
      scheduleContinuation: async (runId: string) => {
        continues.push(runId);
      },
    } as never,
    {
      listMetadata: async () => [...runs.values()].map((state) => state.run),
      list: async () =>
        [...runs.values()].map((state) => ({
          ...state,
          prompts: state.prompts ?? [],
        })),
      listActive: async () =>
        [...runs.values()]
          .filter(
            (state) =>
              !["completed", "cancelled", "failed"].includes(state.run.status),
          )
          .map((state) => ({
            ...state,
            prompts: state.prompts ?? [],
          })),
      findActive: async () => {
        beforeFindActive?.();
        return [...runs.values()].find(
          (state) =>
            !["completed", "cancelled", "failed"].includes(state.run.status),
        );
      },
      loadFresh: async (runId: string) => runs.get(runId),
      load: async (runId: string) => runs.get(runId),
    } as never,
    {} as never,
    {
      inputs,
      setActivationState: async (_id, state) => {
        agent.activationState = state;
      },
      getAgentHistory: async () => [
        {
          id: "entry_original",
          agentId: agent.id,
          conversationId: agent.conversationId,
          role: "assistant",
          kind: "message",
          text: "original response",
          runId: "run_1",
          createdAt: new Date().toISOString(),
        },
        {
          id: "entry_later",
          agentId: agent.id,
          conversationId: agent.conversationId,
          role: "assistant",
          kind: "message",
          text: "later mutable response",
          runId: "run_2",
          createdAt: new Date().toISOString(),
        },
      ],
      ...options,
    },
  );
  return {
    service,
    inputs,
    agent,
    runs,
    starts,
    commandPrompts,
    continues,
    settledForAgent: (callback: () => Promise<void>) => {
      settledForAgent = callback;
    },
    beforeRunControl: (callback: () => Promise<void>) => {
      beforeRunControl = callback;
    },
    beforeFindActive: (callback: () => void) => {
      beforeFindActive = callback;
    },
    beforeStart: (callback: () => Promise<void>) => {
      beforeStart = callback;
    },
  };
}
