import { openCoreDatabase, type CoreDatabase } from "./database.js";
import { migrate } from "./migrations.js";
import { ProjectRepository } from "./project.repository.js";
import { TrustedResourceRepository } from "./trusted-resource.repository.js";
import {
  ConversationRepository,
  type ConversationFailureReporter,
} from "./conversation.repository.js";
import { ConversationEventRepository } from "./conversation-event.repository.js";
import { ToolCallRepository } from "./tool-call.repository.js";
import { InputQueueRepository } from "./input-queue.repository.js";
import { AssetRepository } from "./asset.repository.js";
import { AsyncBashRepository } from "./async-bash.repository.js";
import { ScratchNoteRepository } from "./scratch-note.repository.js";

export class CoreStorage {
  readonly projects: ProjectRepository;
  readonly trustedResources: TrustedResourceRepository;
  readonly conversations: ConversationRepository;
  readonly events: ConversationEventRepository;
  readonly toolCalls: ToolCallRepository;
  readonly inputs: InputQueueRepository;
  readonly assets: AssetRepository;
  readonly asyncBash: AsyncBashRepository;
  readonly scratchNotes: ScratchNoteRepository;

  constructor(
    private readonly db: CoreDatabase,
    onConversationFailure?: ConversationFailureReporter,
  ) {
    this.projects = new ProjectRepository(db);
    this.trustedResources = new TrustedResourceRepository(db);
    this.conversations = new ConversationRepository(db, onConversationFailure);
    this.events = new ConversationEventRepository(db);
    this.toolCalls = new ToolCallRepository(db);
    this.inputs = new InputQueueRepository(db);
    this.assets = new AssetRepository(db);
    this.asyncBash = new AsyncBashRepository(db);
    this.scratchNotes = new ScratchNoteRepository(db);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }
  descendantConversationIds(id: string): string[] {
    return this.conversations.descendantConversationIds(id);
  }
  close(): void {
    this.db.close();
  }
}

export function openCoreStorage(
  path: string,
  onConversationFailure?: ConversationFailureReporter,
): CoreStorage {
  const db = openCoreDatabase(path);
  try {
    migrate(db);
    return new CoreStorage(db, onConversationFailure);
  } catch (error) {
    db.close();
    throw error;
  }
}
