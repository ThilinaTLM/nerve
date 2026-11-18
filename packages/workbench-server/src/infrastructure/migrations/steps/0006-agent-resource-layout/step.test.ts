import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createStepContext } from "../../framework/context.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import step from "./step.js";

function home() {
  const root = mkdtempSync(join(tmpdir(), "nerve-0006-"));
  const paths = storagePaths(root);
  const { context } = createStepContext(
    paths,
    step.id,
    step.description,
    () => {},
  );
  const put = (directory: string, name: string, text: string) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), text);
  };
  return { root, paths, context, put };
}

void test("user profiles move from data/agent-profiles to agent/agent-profiles byte for byte", async () => {
  const { paths, context, put } = home();
  put(paths.agentProfilesConfigPath, "reviewer.json", '{"name":"reviewer"}\n');
  put(paths.agentProfilesConfigPath, "writer.json", '{"name":"writer"}\n');
  await step.run(context);
  assert.deepEqual(readdirSync(paths.agentProfilesPath).sort(), [
    "reviewer.json",
    "writer.json",
  ]);
  assert.equal(
    readFileSync(join(paths.agentProfilesPath, "writer.json"), "utf8"),
    '{"name":"writer"}\n',
  );
  assert.equal(existsSync(paths.agentProfilesConfigPath), false);
  await step.verify!(context);
});

void test("a home without user profiles needs no change, and a second run is a no-op", async () => {
  const { paths, context, put } = home();
  await step.run(context);
  assert.equal(existsSync(paths.agentProfilesPath), false);
  put(paths.agentProfilesPath, "kept.json", "{}");
  await step.run(context);
  assert.deepEqual(readdirSync(paths.agentProfilesPath), ["kept.json"]);
});

void test("an existing target wins: identical copies collapse, different ones are quarantined and reported", async () => {
  const { root, paths, context, put } = home();
  put(paths.agentProfilesPath, "same.json", "A");
  put(paths.agentProfilesPath, "differs.json", "NEW");
  put(paths.agentProfilesConfigPath, "same.json", "A");
  put(paths.agentProfilesConfigPath, "differs.json", "OLD");
  put(paths.agentProfilesConfigPath, "moved.json", "M");
  await step.run(context);
  assert.equal(
    readFileSync(join(paths.agentProfilesPath, "differs.json"), "utf8"),
    "NEW",
  );
  assert.equal(
    readFileSync(join(paths.agentProfilesPath, "moved.json"), "utf8"),
    "M",
  );
  assert.equal(existsSync(paths.agentProfilesConfigPath), false);
  // The older, different copy survives in quarantine.
  const quarantined: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(directory, entry.name));
      else quarantined.push(join(directory, entry.name));
    }
  };
  walk(join(root, "quarantine"));
  const payload = quarantined.find((file) => file.endsWith("differs.json"));
  assert.ok(payload);
  assert.equal(readFileSync(payload, "utf8"), "OLD");
  await step.verify!(context);
});
