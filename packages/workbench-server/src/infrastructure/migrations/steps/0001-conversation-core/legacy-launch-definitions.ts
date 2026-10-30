import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { StepContext } from "../../framework/step.js";
import type { LegacyReader } from "./legacy.reader.js";
import { readJson, writeJson } from "./configuration.js";

// Frozen task-definition v1 export. Home migration never opens a project path.
const definition = z
  .object({
    id: z.string().startsWith("taskdef_"),
    scope: z
      .object({ kind: z.literal("project"), projectId: z.string().optional() })
      .transform(() => ({ kind: "project" as const })),
    label: z.string().min(1).optional(),
    command: z.string().refine((value) => value.trim().length > 0),
    cwd: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    runPolicy: z.enum(["single", "concurrent"]).default("single"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
const catalog = z
  .object({ version: z.literal(1), definitions: z.array(definition) })
  .strict();

export async function stageLegacyLaunchDefinitions(input: {
  home: string;
  reader: LegacyReader;
  projectId(id: string): string;
  context?: StepContext;
}): Promise<number> {
  let staged = 0;
  for (const { row, data } of input.reader.documents("task_definitions")) {
    const exportDocument = () => {
      const raw = Array.isArray(data) ? data : data.definitions;
      assert(Array.isArray(raw), "Expected legacy task definitions list");
      const owner = String(raw[0]?.scope?.projectId ?? row.document_id);
      const projectId = input.projectId(owner);
      assert(
        raw.every(
          (item) =>
            item.scope?.projectId === undefined ||
            String(item.scope.projectId) === owner,
        ),
        "Mixed project owners in legacy task definitions",
      );
      const source = catalog.parse({ version: 1, definitions: raw });
      const target = join(
        input.home,
        "data",
        "launches",
        "legacy",
        `${createHash("sha256").update(projectId).digest("hex")}.json`,
      );
      input.context?.ownPaths([target], input.home);
      const existing = catalog.parse(
        readJson(target, { version: 1, definitions: [] }),
      );
      const byId = new Map(existing.definitions.map((item) => [item.id, item]));
      for (const item of source.definitions) {
        const before = byId.get(item.id);
        assert(
          !before || JSON.stringify(before) === JSON.stringify(item),
          `Conflicting staged launch definition ${item.id}`,
        );
        if (!before) {
          existing.definitions.push(item);
          byId.set(item.id, item);
          staged++;
        }
      }
      writeJson(target, existing);
    };
    if (input.context)
      await input.context.unit(
        {
          kind: "configuration",
          id: `legacy-record:task_definitions/${row.document_id}`,
          title: "Stage legacy launch definitions",
        },
        exportDocument,
        { quarantine: { records: [{ table: "domain_documents", row }] } },
      );
    else exportDocument();
  }
  return staged;
}
