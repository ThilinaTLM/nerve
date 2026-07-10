import {
  buildConversationContext,
  convertToLlm,
} from "@nervekit/host-runtime/harness";
import {
  executeBash,
  type ToolExecutionResult,
} from "@nervekit/host-runtime/tools";
import {
  type AgentRecord,
  type ConversationEntry,
  createId,
  deriveConversationTitle,
  type ToolCallRecord,
} from "@nervekit/contracts";
import { HttpError } from "../../../http/errors.js";
import type { AgentRunnerDeps } from "./agent-runner.js";
import {
  bashExecutionMessageForToolCall,
  inlineCommandDisplayText,
  inlineCommandEntryDetails,
} from "./inline-command-results.js";

export class InlineCommandRunner {
  constructor(
    readonly deps: AgentRunnerDeps,
    readonly terminateRunToolCalls: (
      runId: string,
      message?: string,
    ) => Promise<void>,
  ) {}

  async executeBashCommand(
    agent: AgentRecord,
    command: string,
    options: {
      runId: string;
      signal?: AbortSignal;
      continueAfterPromotedTask?: boolean;
      useForegroundBash?: boolean;
    },
  ): Promise<ToolCallRecord> {
    const toolCall = await this.deps.tools.requestToolAndWait(
      agent,
      "bash",
      { command },
      {
        runId: options.runId,
        signal: options.signal,
        continueAfterPromotedTask: options.continueAfterPromotedTask,
        useForegroundBash: options.useForegroundBash,
      },
    );
    if (options.signal?.aborted) throw new Error("Command execution aborted.");
    return toolCall;
  }

  async executePromptBlockCommand(
    agent: AgentRecord,
    command: string,
    options: { signal?: AbortSignal },
  ): Promise<ToolExecutionResult> {
    return executeBash(
      { command },
      {
        cwd: agent.projectDir,
        signal: options.signal,
        dataDir: this.deps.storage.paths.home,
        shellPath: this.deps.storage.settings.runtime.shellPath,
      },
    );
  }

  async runPrompt(
    agent: AgentRecord,
    command: string,
  ): Promise<ConversationEntry> {
    if (this.deps.state.runs.has(agent.id)) {
      throw new HttpError(409, "AGENT_BUSY", "Agent is already running.");
    }

    const runId = createId("run");
    const entryId = createId("entry");
    const abortController = new AbortController();
    let abortRequested = false;
    const startedAt = new Date().toISOString();
    const runStartedAt = performance.now();

    try {
      const conversation = this.deps.state.getConversation(
        agent.conversationId,
      );
      const project = this.deps.state.getProject(agent.projectId);
      this.deps.state.conversationRuntime.startRun({
        agentId: agent.id,
        projectId: agent.projectId,
        conversationId: agent.conversationId,
        runId,
        startedAt,
      });
      await this.deps.events.publish("run.started", {
        agentId: agent.id,
        projectId: agent.projectId,
        conversationId: agent.conversationId,
        runId,
        parentEntryId: conversation.activeEntryId,
        startedAt,
      });
      this.deps.state.runs.set(agent.id, {
        runId,
        abort: () => {
          abortRequested = true;
          this.deps.state.conversationRuntime.markAborting(runId);
          abortController.abort();
        },
        messages: this.deps.conversationService.getForAgent(agent.id) ?? [],
      });
      await this.deps.setAgentStatus(agent, "running");

      const toolCall = await this.executeBashCommand(agent, command, {
        runId,
        signal: abortController.signal,
        continueAfterPromotedTask: false,
        useForegroundBash: false,
      });
      const createdAt = new Date().toISOString();
      await this.deps.harnessManager.appendAgentMessageWithId(
        agent,
        entryId,
        bashExecutionMessageForToolCall(toolCall, createdAt),
        createdAt,
      );
      const entry = await this.deps.appendEntry(
        {
          id: entryId,
          conversationId: agent.conversationId,
          agentId: agent.id,
          runId,
          role: "system",
          kind: "message",
          text: inlineCommandDisplayText(toolCall),
          details: inlineCommandEntryDetails(toolCall),
          createdAt,
        },
        { mirrorToHarness: false },
      );
      await this.deps.events.publish("conversation.entry.appended", {
        conversationId: agent.conversationId,
        agentId: agent.id,
        runId,
        entry,
      });

      if (
        this.deps.state.getConversationEntries(agent.conversationId).length ===
        1
      ) {
        const title = deriveConversationTitle(`! ${command}`);
        if (title) {
          const latestConversation = this.deps.state.getConversation(
            agent.conversationId,
          );
          await this.deps.updateConversation({
            ...latestConversation,
            title,
            updatedAt: createdAt,
          });
          await this.deps.events.publish("conversation.updated", {
            conversation: this.deps.state.conversations.get(
              agent.conversationId,
            ),
          });
        }
      }

      const storage = await this.deps.harnessManager.openStorage(
        conversation,
        project.dir,
      );
      const branch = await storage.getPathToRoot(await storage.getLeafId());
      const messages = convertToLlm(buildConversationContext(branch).messages);
      this.deps.conversationService.setForAgent(agent.id, messages);

      const latest = this.deps.state.agents.get(agent.id);
      if (latest) await this.deps.setAgentStatus(latest, "idle");
      this.deps.state.runs.delete(agent.id);
      this.deps.state.conversationRuntime.completeRun(runId);
      const completedAt = new Date().toISOString();
      await this.deps.events.publish("run.completed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        conversationId: agent.conversationId,
        finalEntryId: entry.id,
        completedAt,
      });
      await this.deps.logger.info("Inline command run completed", {
        agentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
        runId,
        durationMs: Math.round(performance.now() - runStartedAt),
        context: { finalEntryId: entry.id },
      });
      return entry;
    } catch (error) {
      this.deps.state.runs.delete(agent.id);
      const aborted = abortRequested || abortController.signal.aborted;
      const latest = this.deps.state.agents.get(agent.id);
      if (latest)
        await this.deps.setAgentStatus(latest, aborted ? "aborted" : "error");
      this.deps.state.conversationRuntime.failRun(runId);
      await this.terminateRunToolCalls(runId);
      const message = error instanceof Error ? error.message : String(error);
      await this.deps.events.publish("run.failed", {
        agentId: agent.id,
        projectId: agent.projectId,
        runId,
        conversationId: agent.conversationId,
        message,
        aborted,
        failedAt: new Date().toISOString(),
      });
      await this.deps.logger[aborted ? "warn" : "error"](
        aborted ? "Inline command run aborted" : "Inline command run failed",
        {
          agentId: agent.id,
          conversationId: agent.conversationId,
          projectId: agent.projectId,
          runId,
          durationMs: Math.round(performance.now() - runStartedAt),
          context: { aborted },
          error,
        },
      );
      throw error;
    }
  }
}
