import type {
  ConversationActiveRunSnapshot,
  ConversationLiveMessageSnapshot,
  ConversationLiveTurnSnapshot,
} from "@nervekit/contracts/conversations";
import type { ConversationRenderState } from "./conversation-render-state.js";

/**
 * Dispatch-local ownership helper for the conversation reducer.
 *
 * The reducer intentionally keeps imperative handlers, but every nested value
 * they write must first be owned here. This preserves immutable render
 * snapshots without cloning the complete active run for every live delta.
 */
export class ConversationCowDraft {
  private runOwned = false;
  private turnsOwned = false;
  private outputMapOwned = false;
  private transientOwned = false;
  private readonly ownedTurns = new Set<string>();
  private readonly ownedMessages = new Set<string>();
  private readonly ownedBlocks = new Set<string>();

  constructor(readonly state: ConversationRenderState) {}

  ownRun(): ConversationActiveRunSnapshot | undefined {
    const run = this.state.activeRun;
    if (!run || this.runOwned) return run;
    this.state.activeRun = { ...run };
    this.runOwned = true;
    return this.state.activeRun;
  }

  ownTurns(): ConversationActiveRunSnapshot | undefined {
    const run = this.ownRun();
    if (!run || this.turnsOwned) return run;
    run.turns = [...run.turns];
    this.turnsOwned = true;
    return run;
  }

  ownTurn(turnId: string): ConversationLiveTurnSnapshot | undefined {
    const run = this.ownTurns();
    if (!run) return undefined;
    const index = run.turns.findIndex((turn) => turn.turnId === turnId);
    if (index < 0) return undefined;
    if (!this.ownedTurns.has(turnId)) {
      run.turns[index] = { ...run.turns[index] };
      this.ownedTurns.add(turnId);
    }
    return run.turns[index];
  }

  ownMessage(
    turnId: string,
    liveMessageId: string,
  ): ConversationLiveMessageSnapshot | undefined {
    const turn = this.ownTurn(turnId);
    if (!turn) return undefined;
    if (!this.ownedMessages.has(turnId)) {
      turn.messages = [...turn.messages];
      this.ownedMessages.add(turnId);
    }
    const index = turn.messages.findIndex(
      (message) => message.liveMessageId === liveMessageId,
    );
    if (index < 0) return undefined;
    const key = `${turnId}\0${liveMessageId}`;
    if (!this.ownedMessages.has(key)) {
      turn.messages[index] = { ...turn.messages[index] };
      this.ownedMessages.add(key);
    }
    return turn.messages[index];
  }

  ownBlock(
    turnId: string,
    liveMessageId: string,
    contentBlockId: string,
  ): void {
    const message = this.ownMessage(turnId, liveMessageId);
    if (!message) return;
    const messageKey = `${turnId}\0${liveMessageId}`;
    if (!this.ownedBlocks.has(messageKey)) {
      message.blocks = [...message.blocks];
      this.ownedBlocks.add(messageKey);
    }
    const index = message.blocks.findIndex(
      (block) => block.contentBlockId === contentBlockId,
    );
    if (index < 0) return;
    const blockKey = `${messageKey}\0${contentBlockId}`;
    if (!this.ownedBlocks.has(blockKey)) {
      const block = message.blocks[index];
      message.blocks[index] =
        block.kind === "tool_call_draft"
          ? {
              ...block,
              args: block.args ? { ...block.args } : undefined,
              progress: block.progress ? { ...block.progress } : undefined,
            }
          : { ...block };
      this.ownedBlocks.add(blockKey);
    }
  }

  ownOutputMap(): void {
    const run = this.ownRun();
    if (!run || this.outputMapOwned) return;
    run.toolOutputsByToolCallId = { ...run.toolOutputsByToolCallId };
    this.outputMapOwned = true;
  }

  ownTransient(): void {
    if (this.transientOwned) return;
    this.state.transient = this.state.transient
      ? { ...this.state.transient }
      : {};
    this.transientOwned = true;
  }

  /** Own turn/message containers before materialization drain reassigns them. */
  ownAllRunMessages(): void {
    const run = this.ownTurns();
    if (!run) return;
    run.turns = run.turns.map((turn) => ({
      ...turn,
      messages: [...turn.messages],
    }));
    this.turnsOwned = true;
    for (const turn of run.turns) {
      this.ownedTurns.add(turn.turnId);
      this.ownedMessages.add(turn.turnId);
    }
  }
}
