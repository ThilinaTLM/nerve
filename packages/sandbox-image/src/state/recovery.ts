import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type SandboxAckState,
  type SandboxAgentState,
  type SandboxCommandRecord,
  type SandboxControllerConnectivityRecord,
  type SandboxCredentialStatusFile,
  type SandboxOutboxRecord,
  type SandboxRunStateRecord,
  type SandboxSecretStoreStatusFile,
  type SandboxSetupStatusFile,
  type SandboxSkillContextFile,
  type SandboxSkillLoadedFile,
  type SandboxStateLayoutVersion,
  sandboxAckStateSchema,
  sandboxAgentStateSchema,
  sandboxCommandRecordSchema,
  sandboxControllerConnectivityRecordSchema,
  sandboxCredentialStatusFileSchema,
  sandboxOutboxRecordSchema,
  sandboxRunStateRecordSchema,
  sandboxSecretStoreStatusFileSchema,
  sandboxSetupStatusFileSchema,
  sandboxSkillContextFileSchema,
  sandboxSkillLoadedFileSchema,
  sandboxStateLayoutVersionSchema,
  startupSetupStatusSchema,
} from "@nervekit/shared";
import {
  asCorruptionError,
  SandboxStateCorruptionError,
} from "./corruption.js";
import { isNotFound } from "./json-store.js";
import {
  resolveSandboxRuntimePaths,
  type SandboxRuntimePaths,
} from "./state-layout.js";

export type RecoveredSandboxState = {
  version: SandboxStateLayoutVersion;
  configDigest: string;
  priorConfigDigest?: string;
  configChanged: boolean;
  commands: SandboxCommandRecord[];
  ack: SandboxAckState;
  unackedEvents: SandboxOutboxRecord[];
  connectivity?: SandboxControllerConnectivityRecord;
  credentials?: SandboxCredentialStatusFile;
  secretStores?: SandboxSecretStoreStatusFile;
  setup?: SandboxSetupStatusFile;
  skills?: {
    context?: SandboxSkillContextFile;
    loaded?: SandboxSkillLoadedFile;
  };
  runs: SandboxRunStateRecord[];
  agents: SandboxAgentState[];
};

export async function recoverSandboxState(
  configDigest: string,
  paths: SandboxRuntimePaths = resolveSandboxRuntimePaths(),
): Promise<RecoveredSandboxState> {
  const version = await readJsonStrict(
    path.join(paths.stateDir, "VERSION"),
    sandboxStateLayoutVersionSchema,
  );
  const priorConfigDigest = await readTextOptional(
    path.join(paths.configDir, "digest.txt"),
  );
  const commands = await readJsonlStrict(
    path.join(paths.commandsDir, "inbox.jsonl"),
    sandboxCommandRecordSchema,
  );
  const events = await readJsonlStrict(
    path.join(paths.eventsDir, "outbox.jsonl"),
    sandboxOutboxRecordSchema,
  );
  const ack = (await readJsonOptional(
    path.join(paths.eventsDir, "ack.json"),
    sandboxAckStateSchema,
  )) ?? { streams: [], updatedAt: new Date().toISOString() };
  const processedSeq = Math.max(
    0,
    ...ack.streams.map((stream) => stream.processedSeq),
  );
  const unackedEvents = events.filter(
    (event) => event.durability === "durable" && event.seq > processedSeq,
  );
  const [connectivity, credentials, secretStores, setup, context, loaded] =
    await Promise.all([
      readJsonOptional(
        path.join(paths.controllerDir, "connectivity.json"),
        sandboxControllerConnectivityRecordSchema,
      ),
      readJsonDiscardCorrupt(
        path.join(paths.credentialsDir, "status.json"),
        sandboxCredentialStatusFileSchema,
      ),
      readJsonDiscardCorrupt(
        path.join(paths.secretsDir, "status.json"),
        sandboxSecretStoreStatusFileSchema,
      ),
      recoverSetupStatus(paths),
      readJsonOptional(
        path.join(paths.skillsDir, "context-files.json"),
        sandboxSkillContextFileSchema,
      ),
      readJsonOptional(
        path.join(paths.skillsDir, "loaded.json"),
        sandboxSkillLoadedFileSchema,
      ),
    ]);
  const { runs, agents } = await recoverConversationState(paths);
  return {
    version,
    configDigest,
    priorConfigDigest: priorConfigDigest?.trim() || undefined,
    configChanged: (priorConfigDigest?.trim() || configDigest) !== configDigest,
    commands,
    ack,
    unackedEvents,
    connectivity,
    credentials,
    secretStores,
    setup,
    skills: { context, loaded },
    runs: reconcileRuns(runs),
    agents,
  };
}

function reconcileRuns(runs: SandboxRunStateRecord[]): SandboxRunStateRecord[] {
  const now = new Date().toISOString();
  return runs.map((run) => {
    if (run.status === "running") {
      return {
        ...run,
        status: "failed",
        updatedAt: now,
        terminalAt: now,
        error: {
          code: "RECOVERED_IN_FLIGHT_RUN",
          message:
            "Run was in flight during restart and was not marked successful.",
          retryable: true,
        },
      };
    }
    if (run.status === "queued") return { ...run, updatedAt: now };
    return run;
  });
}

async function recoverSetupStatus(
  paths: SandboxRuntimePaths,
): Promise<SandboxSetupStatusFile | undefined> {
  const combined = await readJsonOptional(
    path.join(paths.setupDir, "status.json"),
    sandboxSetupStatusFileSchema,
  );
  if (combined) return combined;
  const [git, github] = await Promise.all([
    readJsonOptional(
      path.join(paths.setupDir, "git.json"),
      startupSetupStatusSchema,
    ),
    readJsonOptional(
      path.join(paths.setupDir, "github.json"),
      startupSetupStatusSchema,
    ),
  ]);
  if (!git && !github) return undefined;
  return { git, github, updatedAt: new Date().toISOString() };
}

async function recoverConversationState(paths: SandboxRuntimePaths): Promise<{
  runs: SandboxRunStateRecord[];
  agents: SandboxAgentState[];
}> {
  const runs: SandboxRunStateRecord[] = [];
  const agents: SandboxAgentState[] = [];
  for (const conversationId of await listDirs(paths.conversationsDir)) {
    const agentsDir = path.join(
      paths.conversationsDir,
      conversationId,
      "agents",
    );
    for (const agentId of await listDirs(agentsDir)) {
      const agent = await readJsonOptional(
        path.join(agentsDir, agentId, "state.json"),
        sandboxAgentStateSchema,
      );
      if (agent) agents.push(agent);
      const runsDir = path.join(agentsDir, agentId, "runs");
      for (const runId of await listDirs(runsDir)) {
        const run = await readJsonOptional(
          path.join(runsDir, runId, "state.json"),
          sandboxRunStateRecordSchema,
        );
        if (run) runs.push(run);
      }
    }
  }
  return { runs, agents };
}

async function listDirs(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function readTextOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function readJsonStrict<T>(
  filePath: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isNotFound(error)) throw error;
    throw asCorruptionError("Corrupt recovery-critical JSON", filePath, error);
  }
}

async function readJsonOptional<T>(
  filePath: string,
  schema: { parse(value: unknown): T },
  defaultValue?: T,
): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isNotFound(error)) return defaultValue;
    throw asCorruptionError("Corrupt recovery-critical JSON", filePath, error);
  }
}

async function readJsonDiscardCorrupt<T>(
  filePath: string,
  schema: { parse(value: unknown): T },
): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (isNotFound(error)) return undefined;
    if (error instanceof SandboxStateCorruptionError) return undefined;
    return undefined;
  }
}

async function readJsonlStrict<T>(
  filePath: string,
  schema: { parse(value: unknown): T },
): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const records: T[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(schema.parse(JSON.parse(line)));
    } catch (error) {
      throw asCorruptionError(
        `Corrupt recovery-critical JSONL record ${index + 1}`,
        filePath,
        error,
      );
    }
  }
  return records;
}
