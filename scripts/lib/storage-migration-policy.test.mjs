import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  STORAGE_MIGRATIONS_DIRECTORY,
  storageMigrationChecksum,
  storageMigrationPolicyViolations,
} from "./storage-migration-policy.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "nerve-migration-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, source) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  };
  const step = (id, source = "export default {};\n") => {
    const folder = `${STORAGE_MIGRATIONS_DIRECTORY}/steps/${id}`;
    write(`${folder}/step.ts`, source);
    write(`${folder}/step.test.ts`, "// covered\n");
    return storageMigrationChecksum(join(root, folder));
  };
  const lock = (entries) => {
    write(
      `${STORAGE_MIGRATIONS_DIRECTORY}/migrations.lock.json`,
      JSON.stringify({
        format: "nerve-storage-migrations-lock",
        version: 1,
        migrations: entries,
      }),
    );
    write(
      `${STORAGE_MIGRATIONS_DIRECTORY}/steps/index.ts`,
      entries
        .map(({ id }, index) => `import step${index} from "./${id}/step.js";`)
        .join("\n"),
    );
  };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  return { root, write, step, lock, git };
}

test("accepts contiguous locked steps and ignores test files in checksums", (t) => {
  const { root, write, step, lock } = fixture(t);
  const checksum = step("0001-create-store");
  write(
    `${STORAGE_MIGRATIONS_DIRECTORY}/steps/0001-create-store/step.test.ts`,
    "// edits to tests do not rewrite history\n",
  );
  lock([
    {
      id: "0001-create-store",
      kind: "schema",
      checksum,
      stage: "final",
      acceptedChecksums: [],
      legacyAdoptionChecksums: ["a".repeat(64)],
    },
  ]);
  assert.deepEqual(storageMigrationPolicyViolations(root), []);
});

test("reports lock drift, missing tests, invalid lifecycle metadata and gaps", (t) => {
  const { root, step, lock } = fixture(t);
  step("0002-gap");
  rmSync(
    join(root, STORAGE_MIGRATIONS_DIRECTORY, "steps/0002-gap/step.test.ts"),
  );
  lock([
    {
      id: "0002-gap",
      kind: "unknown",
      checksum: "0".repeat(64),
      stage: "released",
      acceptedChecksums: "bad",
      legacyAdoptionChecksums: ["also-bad"],
    },
  ]);
  const failures = storageMigrationPolicyViolations(root);
  assert.ok(
    failures.some((message) => message.includes("ordinals must be contiguous")),
  );
  assert.ok(
    failures.some((message) => message.includes("invalid migration kind")),
  );
  assert.ok(failures.some((message) => message.includes("require releasedIn")));
  assert.ok(failures.some((message) => message.includes("acceptedChecksums")));
  assert.ok(
    failures.some((message) => message.includes("legacyAdoptionChecksums")),
  );
  assert.ok(failures.some((message) => message.includes("lock checksum")));
  assert.ok(failures.some((message) => message.includes("requires a test")));
});

test("legacy adoption evidence is separate from framework checksum acceptance", (t) => {
  const { root, write, step, lock, git } = fixture(t);
  const id = "0001-frozen";
  const previousChecksum = step(id, "export default { version: 1 };\n");
  lock([
    {
      id,
      kind: "schema",
      checksum: previousChecksum,
      stage: "final",
      acceptedChecksums: [],
      legacyAdoptionChecksums: ["a".repeat(64)],
    },
  ]);
  git("init", "--quiet");
  git("config", "user.email", "migration-policy@example.invalid");
  git("config", "user.name", "Migration Policy Test");
  git("add", ".");
  git("commit", "--quiet", "-m", "baseline");
  git("update-ref", "refs/remotes/origin/main", "HEAD");

  write(
    `${STORAGE_MIGRATIONS_DIRECTORY}/steps/${id}/step.ts`,
    "export default { version: 2 };\n",
  );
  const currentChecksum = storageMigrationChecksum(
    join(root, STORAGE_MIGRATIONS_DIRECTORY, "steps", id),
  );
  lock([
    {
      id,
      kind: "schema",
      checksum: currentChecksum,
      stage: "final",
      acceptedChecksums: [],
      legacyAdoptionChecksums: [previousChecksum],
    },
  ]);

  assert.ok(
    storageMigrationPolicyViolations(root).some((message) =>
      message.includes("must accept its previous checksum"),
    ),
  );
});

test("rejects overlap between adoption evidence and accepted checksums", (t) => {
  const { root, step, lock } = fixture(t);
  const checksum = step("0001-overlap");
  lock([
    {
      id: "0001-overlap",
      kind: "schema",
      checksum,
      stage: "draft",
      acceptedChecksums: ["a".repeat(64)],
      legacyAdoptionChecksums: ["a".repeat(64)],
    },
  ]);
  assert.ok(
    storageMigrationPolicyViolations(root).some((message) =>
      message.includes("must not be a framework accepted checksum"),
    ),
  );
});

test("enforces the frozen step import boundary", (t) => {
  const { root, step, lock } = fixture(t);
  const checksum = step(
    "0001-bad-imports",
    'import fs from "fs";\nimport { z } from "zod";\nimport value from "../../../domains/example.js";\nconst load = (name) => import(name);\nexport default { fs, z, value, load };\n',
  );
  lock([
    {
      id: "0001-bad-imports",
      kind: "data",
      checksum,
      stage: "draft",
      acceptedChecksums: [],
    },
  ]);
  const failures = storageMigrationPolicyViolations(root);
  assert.ok(failures.some((message) => message.includes("import zod")));
  assert.ok(failures.some((message) => message.includes("Node built-ins")));
  assert.ok(failures.some((message) => message.includes("domain code")));
  assert.ok(
    failures.some((message) => message.includes("non-literal dynamic")),
  );
});

test("rejects drafts specifically when CI targets main", (t) => {
  const { root, step, lock } = fixture(t);
  const checksum = step("0001-draft");
  lock([
    {
      id: "0001-draft",
      kind: "schema",
      checksum,
      stage: "draft",
      acceptedChecksums: [],
    },
  ]);
  assert.deepEqual(
    storageMigrationPolicyViolations(root, { baseRef: "feature-branch" }),
    [],
  );
  assert.ok(
    storageMigrationPolicyViolations(root, { baseRef: "main" }).some(
      (message) => message.includes("may not merge to main"),
    ),
  );
});

test("requires lock and folder inventories to agree", (t) => {
  const { root, step, lock } = fixture(t);
  const checksum = step("0001-present");
  lock([
    {
      id: "0001-missing",
      kind: "schema",
      checksum,
      stage: "draft",
      acceptedChecksums: [],
    },
  ]);
  const failures = storageMigrationPolicyViolations(root);
  assert.ok(failures.some((message) => message.includes("has no lock entry")));
  assert.ok(failures.some((message) => message.includes("has no step folder")));
});
