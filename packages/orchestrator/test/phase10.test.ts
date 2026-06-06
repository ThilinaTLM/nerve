import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, describe, it } from "node:test";
import { providerEnvVar } from "../src/registry.js";
import { EncryptedFileSecretProvider } from "../src/secrets.js";
import { createOrchestratorState } from "../src/server.js";
import { initializeStorage, writeSettings } from "../src/storage.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-phase10-"));
  roots.push(root);
  return root;
}

describe("phase 10 hardening helpers", () => {
  it("persists settings patches without dropping nested defaults", async () => {
    const storage = await initializeStorage(await tempHome());
    const settings = await writeSettings(storage, {
      defaultPermissionLevel: "autonomous",
      server: { allowRemote: true },
    });

    assert.equal(settings.defaultPermissionLevel, "autonomous");
    assert.equal(settings.defaultSubagentPermissionLevel, "autonomous");
    assert.equal(settings.server.host, "127.0.0.1");
    assert.equal(settings.server.allowRemote, true);
    assert.equal(storage.settings.server.allowRemote, true);
  });

  it("stores provider API keys encrypted behind the secret provider", async () => {
    const home = await tempHome();
    const secrets = new EncryptedFileSecretProvider(home);
    await secrets.set("provider:openai:apiKey", "sk-test");

    assert.equal(await secrets.get("provider:openai:apiKey"), "sk-test");
    assert.deepEqual(await secrets.list(), ["provider:openai:apiKey"]);
    assert.equal(providerEnvVar("openai"), "OPENAI_API_KEY");

    await secrets.delete("provider:openai:apiKey");
    assert.equal(await secrets.get("provider:openai:apiKey"), undefined);
  });

  it("reuses projects by canonical working directory", async () => {
    const storage = await initializeStorage(await tempHome());
    const state = createOrchestratorState(storage, "127.0.0.1", 0);
    await state.events.hydrate();
    await state.registry.hydrate();

    const projectDir = await mkdtemp(join(tmpdir(), "nerve-project-"));
    roots.push(projectDir);
    const first = await state.registry.createProject({ dir: projectDir });
    const second = await state.registry.createProject({
      dir: projectDir,
      name: "Duplicate",
    });
    const third = await state.registry.createProject({
      dir: relative(process.cwd(), projectDir),
    });

    assert.equal(second.id, first.id);
    assert.equal(third.id, first.id);
    assert.equal(state.registry.listProjects().length, 1);

    state.index.close();
  });

  it("imports and exports inspectable conversation bundles", async () => {
    const storage = await initializeStorage(await tempHome());
    const state = createOrchestratorState(storage, "127.0.0.1", 0);
    await state.events.hydrate();
    await state.registry.hydrate();

    const imported = await state.registry.importConversation({
      project: { dir: process.cwd(), name: "Imported" },
      conversation: {
        title: "Imported transcript",
        mode: "coding",
        permissionLevel: "supervised",
      },
      entries: [
        {
          id: "entry_01HN0000000000000000000000",
          conversationId: "conv_01HN0000000000000000000000",
          role: "user",
          kind: "message",
          text: "Please summarize this.",
          createdAt: new Date().toISOString(),
        },
        {
          id: "entry_01HN0000000000000000000001",
          conversationId: "conv_01HN0000000000000000000000",
          parentEntryId: "entry_01HN0000000000000000000000",
          role: "assistant",
          kind: "message",
          text: "Summary complete.",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const bundle = state.registry.exportConversation(imported.conversation.id);
    const markdown = state.registry.exportConversationMarkdown(
      imported.conversation.id,
    );
    const html = state.registry.exportConversationHtml(
      imported.conversation.id,
    );

    assert.equal(bundle.entries.length, 2);
    assert.match(markdown, /Imported transcript/);
    assert.match(markdown, /Summary complete/);
    assert.match(html, /<!doctype html>/);

    state.index.close();
  });
});
