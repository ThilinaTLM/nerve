import {
  type AgentMessageContentKind,
  type ConversationActiveRunSnapshot,
  type ConversationLiveContentDeltaData,
  type ConversationLiveContentDoneData,
  type ConversationLiveMessageSnapshot,
  type ConversationLiveMessageStartedData,
  type ConversationLiveTextBlockSnapshot,
  type ConversationLiveToolDraftBlockSnapshot,
  type ConversationLiveToolDraftDeltaData,
  type ConversationLiveToolDraftDoneData,
  type ConversationLiveToolDraftStartedData,
  type ConversationLiveToolOutputDeltaData,
  type ConversationLiveToolOutputSnapshot,
  type ConversationLiveTurnSnapshot,
  createId,
  type QueuedPromptRecord,
} from "@nerve/shared";

export interface StartRunInput {
  conversationId: string;
  agentId: string;
  projectId: string;
  runId: string;
  startedAt?: string;
}

export interface ToolAnchor {
  runId: string;
  turnId: string;
  liveMessageId: string;
  contentIndex: number;
  providerToolCallId?: string;
}

interface MutableRun extends ConversationActiveRunSnapshot {
  turns: MutableTurn[];
}

interface MutableTurn extends ConversationLiveTurnSnapshot {
  messages: MutableMessage[];
}

interface MutableMessage extends ConversationLiveMessageSnapshot {
  blocks: Array<
    ConversationLiveTextBlockSnapshot | ConversationLiveToolDraftBlockSnapshot
  >;
}

const MAX_LIVE_TOOL_OUTPUT_CHARS = 32_000;
const MAX_LIVE_TOOL_OUTPUT_CHUNKS = 400;

export class ConversationRuntime {
  private readonly runsByRunId = new Map<string, MutableRun>();
  private readonly runIdByAgentId = new Map<string, string>();
  private readonly runIdByConversationId = new Map<string, string>();
  private readonly draftAnchorByProviderToolCallId = new Map<
    string,
    ToolAnchor
  >();

  startRun(input: StartRunInput): ConversationActiveRunSnapshot {
    const startedAt = input.startedAt ?? new Date().toISOString();
    const run: MutableRun = {
      runId: input.runId,
      agentId: input.agentId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      status: "running",
      startedAt,
      turns: [],
      toolOutputsByToolCallId: {},
      queuedPrompts: [],
    };
    this.runsByRunId.set(input.runId, run);
    this.runIdByAgentId.set(input.agentId, input.runId);
    this.runIdByConversationId.set(input.conversationId, input.runId);
    return cloneRun(run);
  }

  markAborting(runId: string): ConversationActiveRunSnapshot | undefined {
    const run = this.runsByRunId.get(runId);
    if (!run) return undefined;
    run.status = "aborting";
    return cloneRun(run);
  }

  queuePrompt(
    runId: string,
    queuedPrompt: QueuedPromptRecord,
  ): ConversationActiveRunSnapshot | undefined {
    const run = this.runsByRunId.get(runId);
    if (!run) return undefined;
    const index = run.queuedPrompts.findIndex(
      (candidate) => candidate.id === queuedPrompt.id,
    );
    if (index === -1) run.queuedPrompts.push(queuedPrompt);
    else run.queuedPrompts[index] = queuedPrompt;
    return cloneRun(run);
  }

  removeQueuedPrompt(
    runId: string | undefined,
    queuedPromptId: string,
  ): ConversationActiveRunSnapshot | undefined {
    if (!runId) return undefined;
    const run = this.runsByRunId.get(runId);
    if (!run) return undefined;
    run.queuedPrompts = run.queuedPrompts.filter(
      (candidate) => candidate.id !== queuedPromptId,
    );
    return cloneRun(run);
  }

  completeRun(runId: string): void {
    const run = this.runsByRunId.get(runId);
    if (!run) return;
    this.runsByRunId.delete(runId);
    this.runIdByAgentId.delete(run.agentId);
    this.runIdByConversationId.delete(run.conversationId);
    for (const turn of run.turns) {
      for (const message of turn.messages) {
        for (const block of message.blocks) {
          if (block.kind === "tool_call_draft" && block.providerToolCallId) {
            this.draftAnchorByProviderToolCallId.delete(
              block.providerToolCallId,
            );
          }
        }
      }
    }
  }

  failRun(runId: string): void {
    this.completeRun(runId);
  }

  startTurn(runId: string): ConversationLiveTurnSnapshot {
    const run = this.requireRun(runId);
    const turn: MutableTurn = {
      turnId: createId("turn"),
      ordinal: run.turns.length,
      messages: [],
    };
    run.turns.push(turn);
    return cloneTurn(turn);
  }

  currentTurn(runId: string): ConversationLiveTurnSnapshot | undefined {
    const run = this.runsByRunId.get(runId);
    const turn = run?.turns.at(-1);
    return turn ? cloneTurn(turn) : undefined;
  }

  startAssistantMessage(
    runId: string,
    turnId: string,
  ): ConversationLiveMessageStartedData {
    const run = this.requireRun(runId);
    const turn = this.requireTurn(run, turnId);
    const startedAt = new Date().toISOString();
    const message: MutableMessage = {
      liveMessageId: createId("msg"),
      messageOrdinal: turn.messages.length,
      startedAt,
      blocks: [],
    };
    turn.messages.push(message);
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId,
      turnId,
      liveMessageId: message.liveMessageId,
      messageOrdinal: message.messageOrdinal,
      startedAt,
    };
  }

  applyContentDelta(input: {
    runId: string;
    turnId: string;
    liveMessageId: string;
    contentIndex: number;
    kind: AgentMessageContentKind;
    delta: string;
  }): ConversationLiveContentDeltaData {
    const { run, message } = this.requireMessage(input);
    const block = this.ensureTextBlock(message, input.contentIndex, input.kind);
    const offset = block.text.length;
    block.text += input.delta;
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      contentBlockId: block.contentBlockId,
      contentIndex: input.contentIndex,
      kind: input.kind,
      offset,
      delta: input.delta,
    };
  }

  finishContent(input: {
    runId: string;
    turnId: string;
    liveMessageId: string;
    contentIndex: number;
    kind: AgentMessageContentKind;
    finalText?: string;
    redacted?: boolean;
  }): ConversationLiveContentDoneData {
    const { run, message } = this.requireMessage(input);
    const block = this.ensureTextBlock(message, input.contentIndex, input.kind);
    if (input.finalText !== undefined) block.text = input.finalText;
    block.done = true;
    block.redacted = input.redacted;
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      contentBlockId: block.contentBlockId,
      contentIndex: input.contentIndex,
      kind: input.kind,
      finalText: input.finalText,
      redacted: input.redacted,
    };
  }

  startToolDraft(input: {
    runId: string;
    turnId: string;
    liveMessageId: string;
    contentIndex: number;
    providerToolCallId?: string;
    toolName?: string;
  }): ConversationLiveToolDraftStartedData {
    const { run, message } = this.requireMessage(input);
    const block = this.ensureToolDraftBlock(message, input.contentIndex);
    block.providerToolCallId =
      input.providerToolCallId ?? block.providerToolCallId;
    block.toolName = input.toolName ?? block.toolName;
    if (block.providerToolCallId)
      this.rememberToolAnchor(input, block.providerToolCallId);
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      contentBlockId: block.contentBlockId,
      contentIndex: input.contentIndex,
      providerToolCallId: block.providerToolCallId,
      toolName: block.toolName,
    };
  }

  applyToolDraftDelta(input: {
    runId: string;
    turnId: string;
    liveMessageId: string;
    contentIndex: number;
    delta: string;
  }): ConversationLiveToolDraftDeltaData {
    const { run, message } = this.requireMessage(input);
    const block = this.ensureToolDraftBlock(message, input.contentIndex);
    const offset = block.argsText.length;
    block.argsText += input.delta;
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      contentBlockId: block.contentBlockId,
      contentIndex: input.contentIndex,
      offset,
      delta: input.delta,
    };
  }

  finishToolDraft(input: {
    runId: string;
    turnId: string;
    liveMessageId: string;
    contentIndex: number;
    providerToolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): ConversationLiveToolDraftDoneData {
    const { run, message } = this.requireMessage(input);
    const block = this.ensureToolDraftBlock(message, input.contentIndex);
    block.providerToolCallId = input.providerToolCallId;
    block.toolName = input.toolName;
    block.args = input.args;
    block.done = true;
    this.rememberToolAnchor(input, input.providerToolCallId);
    return {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      contentBlockId: block.contentBlockId,
      contentIndex: input.contentIndex,
      providerToolCallId: input.providerToolCallId,
      toolName: input.toolName,
      args: input.args,
    };
  }

  applyToolOutputDelta(input: {
    conversationId: string;
    agentId: string;
    projectId: string;
    runId?: string;
    turnId?: string;
    liveMessageId?: string;
    contentIndex?: number;
    providerToolCallId?: string;
    toolCallId: string;
    toolName: string;
    stream: "stdout" | "stderr" | "combined";
    delta: string;
  }): ConversationLiveToolOutputDeltaData {
    const run = input.runId ? this.runsByRunId.get(input.runId) : undefined;
    const existing = run?.toolOutputsByToolCallId[input.toolCallId];
    const offset = existing?.text.length ?? 0;
    const now = new Date().toISOString();
    if (run) {
      const output: ConversationLiveToolOutputSnapshot = capToolOutput({
        toolCallId: input.toolCallId,
        chunks: [
          ...(existing?.chunks ?? []),
          { stream: input.stream, text: input.delta, ts: now },
        ],
        text: `${existing?.text ?? ""}${input.delta}`,
        updatedAt: now,
      });
      run.toolOutputsByToolCallId[input.toolCallId] = output;
    }
    return {
      conversationId: input.conversationId,
      agentId: input.agentId,
      projectId: input.projectId,
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      contentIndex: input.contentIndex,
      providerToolCallId: input.providerToolCallId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      stream: input.stream,
      offset,
      delta: input.delta,
    };
  }

  snapshotForConversation(
    conversationId: string,
  ): ConversationActiveRunSnapshot | undefined {
    const runId = this.runIdByConversationId.get(conversationId);
    const run = runId ? this.runsByRunId.get(runId) : undefined;
    return run ? cloneRun(run) : undefined;
  }

  resolveToolAnchor(
    runId: string,
    providerToolCallId: string,
  ): ToolAnchor | undefined {
    const anchor = this.draftAnchorByProviderToolCallId.get(providerToolCallId);
    return anchor && anchor.runId === runId ? { ...anchor } : undefined;
  }

  private rememberToolAnchor(
    input: {
      runId: string;
      turnId: string;
      liveMessageId: string;
      contentIndex: number;
    },
    providerToolCallId: string,
  ): void {
    this.draftAnchorByProviderToolCallId.set(providerToolCallId, {
      runId: input.runId,
      turnId: input.turnId,
      liveMessageId: input.liveMessageId,
      contentIndex: input.contentIndex,
      providerToolCallId,
    });
  }

  private requireRun(runId: string): MutableRun {
    const run = this.runsByRunId.get(runId);
    if (!run) throw new Error(`Active conversation run not found: ${runId}`);
    return run;
  }

  private requireTurn(run: MutableRun, turnId: string): MutableTurn {
    const turn = run.turns.find((candidate) => candidate.turnId === turnId);
    if (!turn) throw new Error(`Active conversation turn not found: ${turnId}`);
    return turn;
  }

  private requireMessage(input: {
    runId: string;
    turnId: string;
    liveMessageId: string;
  }): { run: MutableRun; turn: MutableTurn; message: MutableMessage } {
    const run = this.requireRun(input.runId);
    const turn = this.requireTurn(run, input.turnId);
    const message = turn.messages.find(
      (candidate) => candidate.liveMessageId === input.liveMessageId,
    );
    if (!message) {
      throw new Error(`Active live message not found: ${input.liveMessageId}`);
    }
    return { run, turn, message };
  }

  private ensureTextBlock(
    message: MutableMessage,
    contentIndex: number,
    kind: AgentMessageContentKind,
  ): ConversationLiveTextBlockSnapshot {
    const existing = message.blocks.find(
      (block) =>
        block.contentIndex === contentIndex && block.kind !== "tool_call_draft",
    );
    if (existing && existing.kind !== "tool_call_draft") return existing;
    const block: ConversationLiveTextBlockSnapshot = {
      kind,
      contentBlockId: createId("block"),
      contentIndex,
      text: "",
      done: false,
    };
    message.blocks.push(block);
    message.blocks.sort((a, b) => a.contentIndex - b.contentIndex);
    return block;
  }

  private ensureToolDraftBlock(
    message: MutableMessage,
    contentIndex: number,
  ): ConversationLiveToolDraftBlockSnapshot {
    const existing = message.blocks.find(
      (block) =>
        block.contentIndex === contentIndex && block.kind === "tool_call_draft",
    );
    if (existing?.kind === "tool_call_draft") return existing;
    const block: ConversationLiveToolDraftBlockSnapshot = {
      kind: "tool_call_draft",
      contentBlockId: createId("block"),
      contentIndex,
      argsText: "",
      done: false,
    };
    message.blocks.push(block);
    message.blocks.sort((a, b) => a.contentIndex - b.contentIndex);
    return block;
  }
}

function cloneRun(run: MutableRun): ConversationActiveRunSnapshot {
  return {
    ...run,
    turns: run.turns.map(cloneTurn),
    toolOutputsByToolCallId: Object.fromEntries(
      Object.entries(run.toolOutputsByToolCallId).map(([id, output]) => [
        id,
        { ...output, chunks: output.chunks.map((chunk) => ({ ...chunk })) },
      ]),
    ),
    queuedPrompts: run.queuedPrompts.map((prompt) => ({ ...prompt })),
  };
}

function cloneTurn(turn: MutableTurn): ConversationLiveTurnSnapshot {
  return {
    ...turn,
    messages: turn.messages.map((message) => ({
      ...message,
      blocks: message.blocks.map((block) => ({ ...block })),
    })),
  };
}

function capToolOutput(
  output: ConversationLiveToolOutputSnapshot,
): ConversationLiveToolOutputSnapshot {
  let text = output.text;
  if (text.length > MAX_LIVE_TOOL_OUTPUT_CHARS) {
    text = text.slice(text.length - MAX_LIVE_TOOL_OUTPUT_CHARS);
  }
  const chunks =
    output.chunks.length > MAX_LIVE_TOOL_OUTPUT_CHUNKS
      ? output.chunks.slice(output.chunks.length - MAX_LIVE_TOOL_OUTPUT_CHUNKS)
      : output.chunks;
  return { ...output, text, chunks };
}
