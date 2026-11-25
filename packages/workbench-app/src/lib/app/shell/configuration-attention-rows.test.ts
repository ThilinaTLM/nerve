import assert from "node:assert/strict";
import test from "node:test";
import type { AttentionEntry } from "$lib/application/configuration-attention/configuration-attention";
import { attentionRows } from "./configuration-attention-rows";

const entry = (patch: Partial<AttentionEntry>): AttentionEntry => ({
  key: "k",
  group: "broken",
  kind: "launch-catalog",
  id: "definitions.json",
  scope: "project",
  path: "/p/.nerve/launches/definitions.json",
  title: "Launch definitions can't load",
  origin: "In this project, from the repository",
  detail: "bad",
  askAgent: "fix",
  diagnostics: [],
  ...patch,
});
const handlers = (projectId: string | undefined = "proj_1") => ({
  projectId,
  onOpenTarget: () => undefined,
  onAskAgent: () => undefined,
  onOpenFile: () => undefined,
});
const labels = (patch: Partial<AttentionEntry>, projectId?: string) =>
  attentionRows([entry(patch)], handlers(projectId))[0]!.actions.map(
    (action) => action.label,
  );

test("a waiting item offers Review only; a broken one the agent and where to look", () => {
  assert.deepEqual(
    labels({
      group: "review",
      askAgent: undefined,
      target: { scope: "project", pageId: "general" },
    }),
    ["Review"],
  );
  assert.deepEqual(labels({}), ["Ask the agent to fix", "Open file"]);
  assert.deepEqual(
    labels({
      kind: "extension",
      scope: "user",
      askAgent: "upgrade",
      target: { scope: "user", pageId: "extensions", item: "csv" },
    }),
    ["Ask the agent to upgrade", "Details"],
  );
});

test("without an open project the agent cannot be asked", () => {
  assert.deepEqual(labels({}, ""), ["Open file"]);
});
