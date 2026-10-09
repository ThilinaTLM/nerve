import { openCoreStorage } from "@nervekit/conversation-core";
import {
  projectSchema,
  scratchNoteSchema,
  trustedResourceSchema,
} from "@nervekit/contracts/core";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importConversation } from "./conversation.importer.js";
import {
  ConversationOverlaysImporter,
  type ImportedConversationOverlays,
} from "./conversation-overlays.importer.js";
import type { EventMapping } from "./events.mapper.js";
import type { SelectedPathVerification } from "./selected-path.validation.js";
import {
  decode,
  ImportIds,
  ImportReport,
  iso,
  LegacyReader,
  type Legacy,
} from "./legacy.reader.js";

export interface CoreImportSummary {
  home: string;
  counts: Record<string, number>;
  skipped: Record<string, number>;
  lossyMappings: Record<string, number>;
  failedTrees: string[];
  selectedPaths: SelectedPathVerification;
  overlays: ImportedConversationOverlays;
  assets: { diskFiles: number; trackedFiles: number; missingFiles: number };
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertOffline(home: string): void {
  const path = join(home, "daemon.json");
  if (!existsSync(path)) return;
  const daemon = JSON.parse(readFileSync(path, "utf8"));
  if (!Number.isInteger(daemon.pid) || daemon.pid <= 0)
    throw new Error(
      "Invalid daemon metadata; verify the home is stopped before importing",
    );
  try {
    process.kill(daemon.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  throw new Error(
    `A live daemon (${daemon.pid}) is using this home; import a stopped copy instead`,
  );
}

function loadByConversation(
  reader: LegacyReader,
  namespace: string,
): Map<string, Legacy[]> {
  const result = new Map<string, Legacy[]>();
  for (const { data } of reader.documents(namespace)) {
    const id = data.conversationId;
    if (id) result.set(id, [...(result.get(id) ?? []), data]);
  }
  return result;
}

function importTrust(
  reader: LegacyReader,
  mapping: EventMapping,
  home: string,
): void {
  const insert = (namespace: string, data: Legacy, key: string): void => {
    const projectScoped = namespace.startsWith("project-");
    const projectId = projectScoped
      ? mapping.ids.get("proj", key)
      : data.projectId
        ? mapping.ids.get("proj", data.projectId)
        : null;
    const project = projectId ? mapping.storage.projects.get(projectId) : null;
    if (projectId && !project) {
      mapping.report.skip("Trust for missing project");
      return;
    }
    const kind =
      namespace === "project-permission-trust"
        ? "project_permissions"
        : namespace === "project-capability-trust"
          ? "project_capabilities"
          : "prompt_suggestion";
    const path =
      data.path ??
      (project
        ? join(
            project.directory,
            ".nerve",
            "config",
            kind === "project_permissions"
              ? "permissions.json"
              : "capabilities.json",
          )
        : null);
    if (!path || !(data.digest ?? data.contentDigest ?? data.predicateHash)) {
      mapping.report.skip("Trust missing path or digest");
      return;
    }
    if (!projectScoped && !data.contentDigest && !data.digest) {
      // A predicate hash is not a digest of approved file content. Do not
      // silently authorize changed code by treating the two as interchangeable.
      mapping.report.skip(
        "Prompt trust predicate hash is not a content digest",
      );
      return;
    }
    if (mapping.storage.trustedResources.find(kind, projectId, path)) return;
    const createdAt = iso(data.trustedAt ?? data.createdAt);
    mapping.storage.trustedResources.insert(
      trustedResourceSchema.parse({
        id: mapping.ids.get(
          "trust",
          data.id ?? data.trustId ?? `${namespace}:${key}`,
        ),
        kind,
        projectId,
        path,
        name: data.name ?? null,
        contentDigest: data.digest ?? data.contentDigest,
        status: data.status === "rejected" ? "rejected" : "trusted",
        createdAt,
        updatedAt: iso(data.updatedAt, createdAt),
      }),
    );
  };
  for (const namespace of [
    "project-permission-trust",
    "project-capability-trust",
    "prompt_suggestion_trust",
    "prompt-suggestion-trust",
  ]) {
    for (const { row, data } of reader.documents(namespace))
      insert(namespace, data, String(row.document_id));
  }
  const cachePath = join(home, "cache", "query-cache.sqlite");
  if (!existsSync(cachePath)) return;
  const cache = new LegacyReader(cachePath);
  try {
    if (cache.hasTable("prompt_suggestion_trust"))
      for (const row of cache.db
        .prepare("SELECT trust_id, json FROM prompt_suggestion_trust")
        .iterate())
        insert(
          "prompt_suggestion_trust",
          decode(row.json),
          String(row.trust_id),
        );
  } finally {
    cache.close();
  }
}

export function importCoreStorage(input: {
  home: string;
  force?: boolean;
}): CoreImportSummary {
  const home = realpathSync(resolve(input.home));
  assertOffline(home);
  const dataDir = realpathSync(join(home, "data"));
  const oldPath = join(dataDir, "nerve.sqlite");
  const newPath = join(dataDir, "core.sqlite");
  if (!lstatSync(oldPath).isFile())
    throw new Error(
      "Legacy database must be a regular file, not a symbolic link",
    );
  if (pathExists(newPath) && !input.force)
    throw new Error("core.sqlite already exists; use --force to replace it");
  if (pathExists(newPath) && !lstatSync(newPath).isFile())
    throw new Error("Destination must be a regular file");
  const reader = new LegacyReader(oldPath);
  const report = new ImportReport();
  let storage;
  let overlays: ImportedConversationOverlays;
  try {
    if (input.force)
      for (const suffix of ["", "-wal", "-shm"])
        rmSync(`${newPath}${suffix}`, { force: true });
    storage = openCoreStorage(newPath);
    const mapping: EventMapping = {
      storage,
      ids: new ImportIds(),
      report,
      dataDir,
      origins: new Map(),
      toolAssets: new Map(),
      responseEvents: new Map(),
      providerResponseEvents: new Map(),
    };
    for (const { data } of reader.documents("project")) {
      storage.projects.insert(
        projectSchema.parse({
          id: mapping.ids.get("proj", data.id),
          name: data.name ?? "Imported project",
          directory: data.dir ?? data.directory,
          createdAt: iso(data.createdAt),
          updatedAt: iso(data.updatedAt ?? data.createdAt),
        }),
      );
    }
    importTrust(reader, mapping, home);
    const overlayImporter = new ConversationOverlaysImporter(
      home,
      dataDir,
      storage,
      report,
    );
    overlays = overlayImporter.counts;
    for (const { row, data } of reader.documents("scratch_notes")) {
      const notes: Legacy[] = Array.isArray(data) ? data : (data.notes ?? []);
      for (const note of notes) {
        const projectId = mapping.ids.get(
          "proj",
          note.projectId ?? String(row.scope_id),
        );
        if (!storage.projects.get(projectId)) {
          report.skip("Note for missing project");
          continue;
        }
        storage.scratchNotes.insert(
          scratchNoteSchema.parse({
            id: mapping.ids.get("note", note.id),
            projectId,
            title: note.title ?? "",
            content: note.content ?? note.text ?? "",
            createdAt: iso(note.createdAt),
            updatedAt: iso(note.updatedAt ?? note.createdAt),
          }),
        );
      }
    }
    report.skip(
      "Approval settlement workflow dropped; persisted rule files are unchanged",
      Number(
        reader.db
          .prepare(
            "SELECT count(*) AS count FROM domain_documents WHERE namespace = 'approval_settlement'",
          )
          .get()!.count,
      ),
    );
    const agents = loadByConversation(reader, "agent");
    const tasks = new Map<string, Legacy[]>();
    for (const { data } of reader.documents("task")) {
      if (data.origin?.kind !== "agent_tool") {
        report.skip("UI launch task");
        continue;
      }
      const toolOwner = data.origin.toolCallId
        ? reader.db
            .prepare(
              "SELECT conversation_id FROM conversation_records WHERE id = ? AND kind = 'tool_call'",
            )
            .get(data.origin.toolCallId)
        : null;
      const conversationId = data.conversationId ?? toolOwner?.conversation_id;
      if (!conversationId) {
        report.skip("Promoted bash task without conversation owner");
        continue;
      }
      tasks.set(String(conversationId), [
        ...(tasks.get(String(conversationId)) ?? []),
        data,
      ]);
    }
    const preparations = new Map<string, Legacy>();
    for (const { data } of reader.documents("agent_input_preparation"))
      preparations.set(data.inputId, data);
    const agentsById = new Map(
      [...agents.values()].flat().map((agent) => [agent.id, agent]),
    );
    const inputs = new Map<string, Legacy[]>();
    for (const { row, data } of reader.documents("agent_inputs")) {
      const agent = agentsById.get(String(row.document_id));
      if (data.paused && agent) agent.activationState = "paused";
      for (const queued of data.inputs ?? []) {
        queued.importPreparation = preparations.get(queued.id);
        inputs.set(queued.conversationId, [
          ...(inputs.get(queued.conversationId) ?? []),
          queued,
        ]);
      }
    }
    const seenConversations = new Set<string>();
    for (const { data: conversation } of reader.documents("conversation")) {
      seenConversations.add(conversation.id);
      mapping.origins.clear();
      mapping.toolAssets.clear();
      mapping.responseEvents.clear();
      mapping.providerResponseEvents.clear();
      try {
        storage.transaction(() => {
          importConversation(
            reader,
            mapping,
            conversation,
            agents.get(conversation.id) ?? [],
            (inputs.get(conversation.id) ?? []).sort(
              (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
            ),
            tasks.get(conversation.id) ?? [],
          );
          overlayImporter.importConversation(
            mapping.ids.get("proj", conversation.projectId),
            conversation.id,
            mapping.ids.get("conv", conversation.id),
          );
        });
        console.log(`Imported ${conversation.id}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        report.failures.push(`${conversation.id}: ${reason}`);
        console.error(`Skipped tree ${conversation.id}: ${reason}`);
      }
    }
    for (const [conversationId, orphanTasks] of tasks) {
      if (!seenConversations.has(conversationId))
        report.skip(
          "Promoted bash task for deleted conversation",
          orphanTasks.length,
        );
    }
  } finally {
    storage?.close();
    reader.close();
  }
  const db = new DatabaseSync(newPath, { readOnly: true });
  const counts: Record<string, number> = {};
  try {
    for (const table of [
      "project",
      "trusted_resource",
      "conversation",
      "conversation_config",
      "conversation_event",
      "tool_call",
      "input_queue",
      "asset",
      "async_bash",
      "scratch_note",
    ])
      counts[table] = Number(
        db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count,
      );
  } finally {
    db.close();
  }
  const summary: CoreImportSummary = {
    home,
    counts,
    skipped: Object.fromEntries(report.skipped),
    lossyMappings: Object.fromEntries(report.losses),
    failedTrees: report.failures,
    selectedPaths: report.selectedPaths,
    overlays,
    assets: {
      diskFiles: report.diskFiles,
      trackedFiles: report.trackedFiles,
      missingFiles: report.missingFiles,
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}
