import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  B,
  fixture,
  lead,
  leadDocument,
  put,
} from "../infrastructure/configuration/agent-configuration/agent-configuration-test-fixture.js";
import { copyConversationDocuments } from "./scoped-agent-configuration.js";

void test("a fork's configuration documents are byte-identical and resolve like the source", async (t) => {
  const f = await fixture(t);
  await f.agent(lead, {
    ...leadDocument,
    revision: 7,
    overrides: { model: B },
  });
  const from = f.service.paths.conversationConfigDirectory("lead");
  const to = f.service.paths.conversationConfigDirectory("lead-fork");
  await put(join(from, "permissions.json"), '{"keep":"bytes"}\n');
  await copyConversationDocuments(from, to);
  for (const name of ["agent.json", "permissions.json"])
    assert.deepEqual(
      await readFile(join(to, name)),
      await readFile(join(from, name)),
    );
  await assert.rejects(readFile(join(to, "capabilities.json")), /ENOENT/);
  const source = await f.service.getEffective("lead");
  const fork = await f.service.getEffective("lead-fork");
  assert.equal(fork.status, "available");
  if (source.status === "available" && fork.status === "available") {
    assert.deepEqual(fork.resolution.settings, source.resolution.settings);
    assert.deepEqual(fork.resolution.settings.model, B);
  }
});

void test("a conversation without agent.json is unavailable, so a fork cannot copy it", async (t) => {
  const f = await fixture(t);
  const missing = await f.service.getEffective("no-document");
  assert.equal(missing.status, "unavailable");
  assert.ok(
    missing.diagnostics.some((issue) => issue.code === "missing-required"),
  );
  await assert.rejects(
    copyConversationDocuments(
      f.service.paths.conversationConfigDirectory("no-document"),
      f.service.paths.conversationConfigDirectory("no-document-fork"),
    ),
    /ENOENT/,
  );
});
