import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { context, setup } from "./agent-profile-test-fixture.js";

const draftLead = {
  model: { provider: "provider", modelId: "draft" },
  reasoningLevel: "high" as const,
};
const draftDocument = {
  schemaVersion: 1 as const,
  profiles: { developer: { enabled: true } },
};

it("previews sparse conversation overrides with no files, events, or project trust changes", async () => {
  const received: unknown[] = [];
  const { service, userPath, projectPath, conversationPath, write, changes } =
    await setup(async (_profile, availabilityContext) => {
      received.push(availabilityContext);
      return [];
    });
  await write(userPath, { developer: { label: "Inherited label" } });
  await write(projectPath, { developer: { instructions: "Imported" } });
  const before = await readFile(projectPath, "utf8");
  const result = await service.preview({
    projectId: context.projectId,
    document: draftDocument,
    lead: draftLead,
  });
  assert.equal(result.scope, "conversation");
  const developer = result.profiles.find((item) => item.name === "developer")!;
  assert.deepEqual(developer.local, { enabled: true });
  assert.equal(developer.origins.fields.enabled, "conversation");
  assert.equal(developer.origins.fields.label, "user");
  assert.equal(developer.effective?.label, "Inherited label");
  assert.equal(developer.effective?.trust, "untrusted");
  assert.ok(
    developer.diagnostics.some((item) => item.code === "untrusted_project"),
  );
  assert.ok(received.length);
  for (const value of received)
    assert.deepEqual(value, { projectId: context.projectId, lead: draftLead });
  await assert.rejects(readFile(conversationPath), { code: "ENOENT" });
  assert.equal(await readFile(projectPath, "utf8"), before);
  assert.deepEqual(changes, []);
  assert.equal(
    (
      await service.configuration({
        scope: "project",
        projectId: context.projectId,
      })
    ).profiles.find((item) => item.name === "developer")?.effective?.trust,
    "untrusted",
  );
});

it("preview preserves invalid lower document and entry diagnostics", async () => {
  const { service, userPath, projectPath, write } = await setup();
  await write(userPath, { developer: { enabled: "invalid" } });
  await write(projectPath, {});
  await writeFile(projectPath, "{");
  const result = await service.preview({
    projectId: context.projectId,
    document: draftDocument,
    lead: draftLead,
  });
  const diagnostics = result.profiles.find(
    (item) => item.name === "developer",
  )!.diagnostics;
  assert.ok(
    diagnostics.some(
      (item) => item.code === "invalid_entry" && item.source === "user",
    ),
  );
  assert.ok(
    diagnostics.some(
      (item) => item.code === "invalid_document" && item.source === "project",
    ),
  );
});

it("atomically replaces only conversation profiles with digest checks and identical retry no-op", async () => {
  const { service, conversationPath, changes } = await setup();
  const first = await service.replaceConversation({
    ...context,
    document: draftDocument,
    expectedDigest: null,
  });
  assert.ok(first.digest);
  assert.deepEqual(first.document, draftDocument);
  assert.deepEqual(
    JSON.parse(await readFile(conversationPath, "utf8")),
    draftDocument,
  );
  assert.deepEqual(changes, [context]);
  assert.equal((await stat(conversationPath)).mode & 0o777, 0o600);
  assert.equal((await stat(join(conversationPath, ".."))).mode & 0o777, 0o700);
  let notified = 0;
  const stop = service.onChanged(() => notified++);
  const retry = await service.replaceConversation({
    ...context,
    document: draftDocument,
    expectedDigest: null,
  });
  assert.equal(retry.digest, first.digest);
  assert.equal(notified, 0);
  assert.deepEqual(changes, [context]);
  const updated = {
    schemaVersion: 1 as const,
    profiles: { developer: { enabled: false } },
  };
  await assert.rejects(
    service.replaceConversation({
      ...context,
      document: updated,
      expectedDigest: null,
    }),
    /changed/,
  );
  const result = await service.replaceConversation({
    ...context,
    document: updated,
    expectedDigest: first.digest!,
  });
  assert.deepEqual(result.document, updated);
  assert.equal(notified, 1);
  stop();
});

it("replacement rejects missing digest, ownership violations and malformed existing files without overwriting", async () => {
  const { service, conversationPath, write, changes } = await setup();
  await assert.rejects(async () =>
    service.replaceConversation({
      ...context,
      document: draftDocument,
    } as never),
  );
  await assert.rejects(
    service.replaceConversation({
      ...context,
      projectId: "proj_other",
      document: draftDocument,
      expectedDigest: null,
    }),
    /belong/,
  );
  await assert.rejects(
    service.replaceConversation({
      ...context,
      conversationId: "../escape",
      document: draftDocument,
      expectedDigest: null,
    }),
    /Invalid conversation/,
  );
  await write(conversationPath, {});
  for (const invalid of [
    "{",
    '{"schemaVersion":1,"profiles":{"developer":{"enabled":"invalid"}}}',
  ]) {
    await writeFile(conversationPath, invalid);
    const configuration = await service.configuration({
      scope: "conversation",
      ...context,
    });
    for (const expectedDigest of [null, configuration.digest!]) {
      await assert.rejects(
        service.replaceConversation({
          ...context,
          document: draftDocument,
          expectedDigest,
        }),
      );
      assert.equal(await readFile(conversationPath, "utf8"), invalid);
    }
  }
  assert.deepEqual(changes, []);
});

it("replacement serializes conflicting drafts and protects symlinked directories", async () => {
  const { service, conversationPath, root } = await setup();
  const results = await Promise.allSettled([
    service.replaceConversation({
      ...context,
      document: draftDocument,
      expectedDigest: null,
    }),
    service.replaceConversation({
      ...context,
      document: { schemaVersion: 1, profiles: {} },
      expectedDigest: null,
    }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  await rm(join(conversationPath, ".."), { recursive: true });
  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(conversationPath, ".."));
  await assert.rejects(
    service.replaceConversation({
      ...context,
      document: draftDocument,
      expectedDigest: null,
    }),
    /symbolic/,
  );
  await assert.rejects(readFile(join(outside, "agent-profiles.json")), {
    code: "ENOENT",
  });
});

it("replacement rechecks the digest immediately before the atomic write", async () => {
  let reads = 0;
  let armed = false;
  let path = "";
  const external = JSON.stringify({
    schemaVersion: 1,
    profiles: { developer: { label: "External edit" } },
  });
  const { service, conversationPath, write, changes } = await setup(
    undefined,
    () => {
      if (armed && ++reads === 3) writeFileSync(path, external);
    },
  );
  path = conversationPath;
  await write(path, {});
  const before = await service.configuration({
    scope: "conversation",
    ...context,
  });
  armed = true;
  await assert.rejects(
    service.replaceConversation({
      ...context,
      document: draftDocument,
      expectedDigest: before.digest!,
    }),
    /changed/,
  );
  assert.equal(await readFile(path, "utf8"), external);
  assert.deepEqual(changes, []);
});

it("a response-lost retry compares valid documents semantically regardless of object key order", async () => {
  const { service, conversationPath, changes } = await setup();
  const document = {
    schemaVersion: 1 as const,
    profiles: {
      developer: {
        enabled: true,
        tools: { web_search: true, web_fetch: false },
      },
      explore: { enabled: false },
    },
  };
  // The caller loses this response, retaining the initial null digest.
  await service.replaceConversation({
    ...context,
    document,
    expectedDigest: null,
  });
  const content = await readFile(conversationPath, "utf8");
  const retry = await service.replaceConversation({
    ...context,
    expectedDigest: null,
    document: {
      schemaVersion: 1,
      profiles: {
        explore: { enabled: false },
        developer: {
          tools: { web_fetch: false, web_search: true },
          enabled: true,
        },
      },
    },
  });
  assert.ok(retry.digest);
  assert.deepEqual(retry.document, document);
  assert.equal(await readFile(conversationPath, "utf8"), content);
  assert.deepEqual(changes, [context]);
});
