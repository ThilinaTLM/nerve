import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { SubagentProfileService } from "../../../src/domains/subagents/index.js";

it("trust and updates isolate invalid project entries without erasing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-profile-isolation-"));
  try {
    const path = join(root, ".nerve", "config", "subagents.json");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        profiles: {
          developer: { permission: "forbidden" },
          explore: { enabled: true },
        },
      }),
    );
    let trustedDigest: string | undefined;
    const service = new SubagentProfileService({
      userPath: join(root, "user", "config", "subagents.json"),
      conversationsPath: join(root, "conversations"),
      getProject: (id) => ({ id, directory: root }),
      getConversation: () => ({ projectId: "proj_one" }),
      trust: {
        isTrusted: (_kind, _project, _path, digest) => digest === trustedDigest,
        decide: (input) => {
          trustedDigest = input.contentDigest;
          return input as never;
        },
      },
      events: { publish: async () => {} },
    });
    const input = { scope: "project" as const, projectId: "proj_one" };
    const configuration = await service.configuration(input);
    await service.trust("proj_one", configuration.digest!);
    assert.deepEqual(
      (await service.usable({ projectId: "proj_one" })).map(
        (profile) => profile.name,
      ),
      ["explore"],
    );
    await service.update({
      ...input,
      name: "explore",
      patch: { tools: { future_tool: true } },
    });
    assert.deepEqual(
      JSON.parse(await readFile(path, "utf8")).profiles.developer,
      { permission: "forbidden" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
