import { openCoreStorage } from "./storage.js";
import {
  projectSchema,
  scratchNoteSchema,
  trustedResourceSchema,
} from "./shapes.js";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import {
  convertPromptTrust,
  convertDocumentPreferences,
} from "./configuration.js";
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
  paths: ImportReport["paths"];
  preferences: { enablement: number; taskDefinitions: number };
  counts: Record<string, number>;
  skipped: Record<string, number>;
  lossyMappings: Record<string, number>;
  selectedPaths: SelectedPathVerification;
  overlays: ImportedConversationOverlays;
  assets: {
    diskFiles: number;
    trackedFiles: number;
    missingFiles: number;
    missingAssetIds: string[];
    relocatedPayloads: Record<string, string>;
  };
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
  scratchDir: string,
): void {
  const insert = (namespace: string, data: Legacy, key: string): void => {
    const projectScoped = namespace.startsWith("project-");
    if (!projectScoped) {
      const converted = convertPromptTrust(data, home, scratchDir);
      if (!converted) {
        mapping.report.skip(
          "Prompt trust could not be validated; needs reapproval",
        );
        return;
      }
      data = converted;
      if (data.sourceKind === "project" && !data.projectId) {
        for (const project of mapping.storage.sqlite
          .prepare("SELECT id, directory FROM project")
          .iterate())
          if (data.path.startsWith(`${project.directory}/`)) {
            data.projectId = project.id;
            break;
          }
        if (!data.projectId) {
          mapping.report.skip("Prompt trust for missing project");
          return;
        }
      }
    }
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
        status: ["rejected", "denied"].includes(data.status)
          ? "rejected"
          : "trusted",
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

export async function importCoreStorage(input: {
  home: string;
  progress(conversationId: string): void;
  scratchDir: string;
}): Promise<CoreImportSummary> {
  const home = realpathSync(resolve(input.home));
  const dataDir = realpathSync(join(home, "data"));
  const oldPath = join(dataDir, "nerve.sqlite.migrating");
  const newPath = join(dataDir, "nerve.sqlite");
  if (!lstatSync(oldPath).isFile())
    throw new Error(
      "Legacy database must be a regular file, not a symbolic link",
    );
  const reader = new LegacyReader(oldPath);
  const report = new ImportReport();
  let storage;
  let overlays: ImportedConversationOverlays;
  let preferences: CoreImportSummary["preferences"];
  try {
    storage = openCoreStorage(newPath);
    const mapping: EventMapping = {
      storage,
      ids: new ImportIds(),
      report,
      dataDir,
      origins: new Map(),
      toolAssets: new Map(),
      sourceAssets: new Map(),
      generatedAssets: new Map(),
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
    importTrust(reader, mapping, home, input.scratchDir);
    preferences = convertDocumentPreferences(reader, storage, home);
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
          for (const agent of agents.get(conversation.id) ?? []) {
            if (agent.parentAgentId)
              overlayImporter.importConversation(
                mapping.ids.get("proj", conversation.projectId),
                conversation.id,
                mapping.ids.get("conv", agent.id),
                Array.isArray(agent.tools) ? agent.tools : undefined,
              );
          }
        });
        input.progress(conversation.id);
        await setImmediate();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Import failed for ${conversation.id}: ${reason}`, {
          cause: error,
        });
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
    paths: report.paths,
    preferences,
    counts,
    skipped: Object.fromEntries(report.skipped),
    lossyMappings: Object.fromEntries(report.losses),
    selectedPaths: report.selectedPaths,
    overlays,
    assets: {
      diskFiles: report.diskFiles,
      trackedFiles: report.trackedFiles,
      missingFiles: report.missingFiles,
      missingAssetIds: report.missingAssetIds,
      relocatedPayloads: report.relocatedPayloads,
    },
  };
  return summary;
}
