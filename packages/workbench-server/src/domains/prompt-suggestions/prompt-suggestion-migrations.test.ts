import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { suggestionConfiguration } from "./prompt-suggestion-migrations.js";
import { loadPromptSuggestionDefinitions } from "./prompt-suggestion-loader.js";
void test("suggestions load per file: healthy, older, absent version, invalid and newer; confirmed reset quarantines only that file", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "suggestion-chain-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const context = { projectId: "p", directory: join(home, "project") };
  const dir = join(context.directory, ".nerve/suggestions");
  await mkdir(dir, { recursive: true });
  const service = new ProjectMigrationService({ home });
  const healthy =
    "---\nschemaVersion: 2\nname: healthy\n---\n\nA healthy suggestion.\n";
  const older =
    "---\nschemaVersion: 1\nname: older\nenable:\n  js: 'true'\n---\n\nOlder suggestion.\n";
  const unversioned =
    "---\nname: unversioned\n---\n\nOld unversioned suggestion.\n";
  const invalid = "---\nschemaVersion: 2\nname: invalid\n---\n\n";
  const newer =
    "---\nschemaVersion: 3\nname: newer\n---\n\nNewer suggestion.\n";
  for (const [name, bytes] of Object.entries({
    healthy,
    older,
    unversioned,
    invalid,
    newer,
  }))
    await writeFile(join(dir, `${name}.md`), bytes);
  const loaded = await loadPromptSuggestionDefinitions(
    [{ kind: "project", dir, projectId: "p" }],
    service,
  );
  assert.deepEqual(loaded.definitions.map((entry) => entry.name).sort(), [
    "healthy",
    "older",
    "unversioned",
  ]);
  assert.equal(
    loaded.definitions.find((entry) => entry.name === "older")?.enableJs,
    "true",
  );
  assert.match(await readFile(join(dir, "older.md"), "utf8"), /enable-js/);
  assert.equal(await readFile(join(dir, "newer.md"), "utf8"), newer);
  assert.equal(
    service
      .health("p")
      .issues.find((issue) => issue.type === "prompt-suggestion:newer.md")
      ?.classification,
    "incompatible",
  );
  await assert.rejects(
    service.reset(context, suggestionConfiguration("newer.md"), true),
    /Only corrupted/,
  );
  await assert.rejects(
    service.reset(context, suggestionConfiguration("invalid.md"), false),
    /confirmation/,
  );
  await service.reset(context, suggestionConfiguration("invalid.md"), true);
  await assert.rejects(readFile(join(dir, "invalid.md")), { code: "ENOENT" });
  assert.equal(await readFile(join(dir, "healthy.md"), "utf8"), healthy);
  assert.equal(
    service
      .health("p")
      .issues.some((issue) => issue.type === "prompt-suggestion:invalid.md"),
    false,
  );
});
