import type {
  ConversationJournalEvent,
  ConversationJournalCommit,
} from "@nervekit/contracts/conversations";
import type {
  ExecutionAttempt,
  LifecycleInteraction,
  LifecycleWork,
  RecoveryIssue,
  RunLifecycleRecord,
  ToolProposal,
} from "@nervekit/contracts/runs";

export interface RunLifecycleCommand {
  conversationId: string;
  requestId: string;
  inputHash: string;
  kind: string;
  events: ConversationJournalEvent[];
  aggregate?: {
    run: RunLifecycleRecord;
    proposals: readonly ToolProposal[];
    interactions: readonly LifecycleInteraction[];
    attempts: readonly ExecutionAttempt[];
    recoveryIssues: readonly RecoveryIssue[];
  };
  work: readonly LifecycleWork[];
  outcome: unknown;
  expectedRevision?: number;
  committedAt?: string;
}

export interface RunLifecycleCommandResult {
  replayed: boolean;
  outcome: unknown;
  commit?: ConversationJournalCommit;
}

export interface RunLifecycleServiceDependencies {
  journal: {
    commit(
      conversationId: string,
      input: {
        kind: string;
        events: ConversationJournalEvent[];
        committedAt?: string;
        idempotencyKey?: string;
        lifecycle?: {
          aggregate?: RunLifecycleCommand["aggregate"];
          work: readonly LifecycleWork[];
          inputHash: string;
          outcome: unknown;
        };
      },
      expectedRevision?: number,
    ): Promise<ConversationJournalCommit>;
  };
  receipts: {
    readLifecycleCommandReceipt(
      scopeId: string,
      requestId: string,
    ): Promise<{ inputHash: string; outcome: unknown } | undefined>;
  };
  wakeWork(): Promise<void> | void;
  onWakeError?(error: unknown): void;
}

/** The sole command boundary for new run-scoped lifecycle journal writes. */
export class RunLifecycleService {
  constructor(private readonly deps: RunLifecycleServiceDependencies) {}

  async commit(
    command: RunLifecycleCommand,
  ): Promise<RunLifecycleCommandResult> {
    const receipt = await this.deps.receipts.readLifecycleCommandReceipt(
      command.conversationId,
      command.requestId,
    );
    if (receipt) {
      this.assertMatchingInput(command, receipt.inputHash);
      return { replayed: true, outcome: receipt.outcome };
    }

    const commit = await this.deps.journal.commit(
      command.conversationId,
      {
        kind: command.kind,
        events: command.events,
        committedAt: command.committedAt,
        idempotencyKey: command.requestId,
        lifecycle: {
          aggregate: command.aggregate,
          work: command.work,
          inputHash: command.inputHash,
          outcome: command.outcome,
        },
      },
      command.expectedRevision,
    );
    const persisted = await this.deps.receipts.readLifecycleCommandReceipt(
      command.conversationId,
      command.requestId,
    );
    if (!persisted) {
      throw new Error(
        `Lifecycle commit ${command.requestId} has no durable receipt.`,
      );
    }
    this.assertMatchingInput(command, persisted.inputHash);
    try {
      await this.deps.wakeWork();
    } catch (error) {
      this.deps.onWakeError?.(error);
    }
    return { replayed: false, outcome: persisted.outcome, commit };
  }

  private assertMatchingInput(
    command: RunLifecycleCommand,
    persistedHash: string,
  ): void {
    if (persistedHash !== command.inputHash) {
      throw new Error(`Conflicting lifecycle request id: ${command.requestId}`);
    }
  }
}
