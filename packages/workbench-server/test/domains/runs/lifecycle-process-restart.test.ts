import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const source = pathToFileURL(
  join(
    fileURLToPath(new URL(".", import.meta.url)),
    "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.ts",
  ),
).href;

test("a killed lifecycle worker leaves fenced durable work for restart recovery", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-lifecycle-kill-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const databasePath = join(home, "nerve.sqlite");
  const script = `
    (async () => {
    const { CanonicalStore } = await import(${JSON.stringify(source)});
    const keepAlive = setInterval(() => {}, 1000);
    const store = new CanonicalStore(process.env.NERVE_TEST_DB);
    await store.initialize();
    const now = "2026-01-01T00:00:00.000Z";
    await store.insertLifecycleWork({
      id: "work_process_kill",
      deduplicationKey: "run_process_kill:execute",
      conversationId: "conv_process_kill",
      runId: "run_process_kill",
      proposalId: "tool_process_kill",
      kind: "execute_tool",
      state: "ready",
      inputHash: "sha256:${"c".repeat(64)}",
      generation: 0,
      attemptCount: 0,
      notBefore: now,
      createdAt: now,
      updatedAt: now
    });
    await store.claimLifecycleWork({
      workId: "work_process_kill",
      expectedGeneration: 0,
      leaseOwner: "boot_killed",
      leaseDeadline: "9999-01-01T00:00:00.000Z",
      now
    });
    console.log("CLAIMED");
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const child = spawn(process.execPath, ["--import=tsx", `--eval=${script}`], {
    env: { ...process.env, NERVE_TEST_DB: databasePath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("CLAIMED")) resolve();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes("CLAIMED")) {
        reject(new Error(`claim child exited early (${code}): ${errors}`));
      }
    });
  });
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));

  const store = new CanonicalStore(databasePath);
  await store.initialize();
  const [abandoned] = await store.listExpiredLifecycleWork(
    "9999-12-31T23:59:59.999Z",
  );
  assert.equal(abandoned?.id, "work_process_kill");
  assert.equal(abandoned?.leaseOwner, "boot_killed");
  assert.equal(abandoned?.generation, 1);
  const classified = await store.settleLifecycleWork({
    workId: abandoned!.id,
    expectedGeneration: abandoned!.generation,
    leaseOwner: abandoned!.leaseOwner!,
    state: "outcome_unknown",
    now: "2026-01-01T00:01:00.000Z",
    lastError: "worker process was killed after claim",
  });
  assert.equal(classified?.state, "outcome_unknown");
  await store.close();
});
