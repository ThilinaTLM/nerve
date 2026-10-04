import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { relative, resolve, sep } from "node:path";

export const STORAGE_MIGRATIONS_DIRECTORY =
  "packages/workbench-server/src/infrastructure/storage-migrations";
export const STORAGE_MIGRATION_KINDS = new Set([
  "schema",
  "data",
  "files",
  "config",
]);
export const STORAGE_MIGRATION_STAGES = new Set(["draft", "final", "released"]);

const stepPattern = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const forbiddenImports = [
  [/@nervekit\/contracts(?:[/'"]|$)/, "@nervekit/contracts"],
  [/(?:^|\/)domains(?:\/|$)/, "domain code"],
  [/(?:^|\/)repositories?(?:\/|$)/, "repositories"],
  [/(?:^|\/)runner(?:\/|$)/, "the migration runner"],
  [/(?:^|\/)kit(?:\/index)?(?:\.[cm]?[jt]s)?$/, "kit barrels"],
  [/^zod(?:\/|$)/, "zod"],
];
const nodeBuiltins = new Set(
  builtinModules.flatMap((module) => [module, `node:${module}`]),
);

function normalize(file) {
  return file.split(sep).join("/");
}

function migrationEntries(lock) {
  if (Array.isArray(lock)) return lock;
  for (const key of ["migrations", "steps", "entries"])
    if (Array.isArray(lock?.[key])) return lock[key];
  return undefined;
}

function checksumListViolation(entry, property) {
  const checksums = entry[property];
  if (checksums == null) return undefined;
  if (
    !Array.isArray(checksums) ||
    checksums.some((checksum) => !/^[a-f0-9]{64}$/.test(checksum))
  )
    return `${entry.id}: ${property} must be SHA-256 strings`;
  if (new Set(checksums).size !== checksums.length)
    return `${entry.id}: ${property} must not contain duplicates`;
  return undefined;
}

export function storageMigrationLockMetadataViolations(entries) {
  const failures = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string")
      continue;
    for (const property of ["acceptedChecksums", "legacyAdoptionChecksums"]) {
      const violation = checksumListViolation(entry, property);
      if (violation) failures.push(violation);
    }
    if (
      Array.isArray(entry.acceptedChecksums) &&
      Array.isArray(entry.legacyAdoptionChecksums) &&
      entry.acceptedChecksums.some((checksum) =>
        entry.legacyAdoptionChecksums.includes(checksum),
      )
    )
      failures.push(
        `${entry.id}: legacy adoption evidence must not be a framework accepted checksum`,
      );
  }
  return failures;
}

export function readStorageMigrationLock(repoRoot) {
  const file = resolve(
    repoRoot,
    STORAGE_MIGRATIONS_DIRECTORY,
    "migrations.lock.json",
  );
  if (!existsSync(file)) return undefined;
  const lock = JSON.parse(readFileSync(file, "utf8"));
  const entries = migrationEntries(lock);
  if (!entries)
    throw new Error("migrations.lock.json must contain a migrations array");
  return { file, lock, entries };
}

function checksumFiles(folder) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (
        entry.isFile() &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      )
        files.push(path);
    }
  };
  visit(folder);
  return files.sort((left, right) =>
    normalize(relative(folder, left)).localeCompare(
      normalize(relative(folder, right)),
    ),
  );
}

export function storageMigrationChecksum(folder) {
  const hash = createHash("sha256");
  for (const file of checksumFiles(folder)) {
    hash.update(normalize(relative(folder, file)));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function imports(source) {
  const values = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*)\(?\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

function gitMainFile(repoRoot, file) {
  try {
    return execFileSync("git", ["show", `origin/main:${file}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function mainEntries(repoRoot) {
  const file = `${STORAGE_MIGRATIONS_DIRECTORY}/migrations.lock.json`;
  const source = gitMainFile(repoRoot, file);
  if (!source) return new Map();
  try {
    return new Map(
      (migrationEntries(JSON.parse(source)) ?? []).map((x) => [x.id, x]),
    );
  } catch {
    return new Map();
  }
}

export function storageMigrationPolicyViolations(
  repoRoot,
  { baseRef = process.env.GITHUB_BASE_REF } = {},
) {
  const root = resolve(repoRoot, STORAGE_MIGRATIONS_DIRECTORY);
  if (!existsSync(root)) return [];
  const failures = [];
  let locked;
  try {
    locked = readStorageMigrationLock(repoRoot);
  } catch (error) {
    return [String(error instanceof Error ? error.message : error)];
  }
  if (!locked)
    return ["storage-migrations exists without migrations.lock.json"];
  if (locked.lock.format !== "nerve-storage-migrations-lock")
    failures.push("migrations.lock.json has an invalid format");
  if (locked.lock.version !== 1)
    failures.push("migrations.lock.json has an unsupported version");
  failures.push(...storageMigrationLockMetadataViolations(locked.entries));

  const stepsRoot = resolve(root, "steps");
  if (!existsSync(stepsRoot))
    return ["migrations.lock.json exists without steps/"];
  const stepDirectories = readdirSync(stepsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const directory of stepDirectories)
    if (!stepPattern.test(directory))
      failures.push(`${directory}: invalid migration step folder name`);
  const folders = stepDirectories.filter((directory) =>
    stepPattern.test(directory),
  );
  const byId = new Map();
  for (const [index, entry] of locked.entries.entries()) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      failures.push(`lock entry ${index + 1} must have an id`);
      continue;
    }
    if (byId.has(entry.id)) failures.push(`duplicate lock entry ${entry.id}`);
    byId.set(entry.id, entry);
    const match = stepPattern.exec(entry.id);
    if (!match) failures.push(`${entry.id}: invalid migration id`);
    else if (Number(match[1]) !== index + 1)
      failures.push(
        `${entry.id}: ordinals must be contiguous and lock-ordered`,
      );
    if (!STORAGE_MIGRATION_KINDS.has(entry.kind))
      failures.push(
        `${entry.id}: invalid migration kind ${String(entry.kind)}`,
      );
    if (!STORAGE_MIGRATION_STAGES.has(entry.stage))
      failures.push(
        `${entry.id}: invalid migration stage ${String(entry.stage)}`,
      );
    if (!/^[a-f0-9]{64}$/.test(entry.checksum ?? ""))
      failures.push(`${entry.id}: checksum must be a SHA-256 string`);
    if (entry.stage === "released" && !entry.releasedIn)
      failures.push(`${entry.id}: released migrations require releasedIn`);
    if (entry.stage !== "released" && entry.releasedIn != null)
      failures.push(`${entry.id}: only released migrations may set releasedIn`);
  }

  for (const folder of folders) {
    const entry = byId.get(folder);
    if (!entry) {
      failures.push(`${folder}: step folder has no lock entry`);
      continue;
    }
    const folderPath = resolve(stepsRoot, folder);
    const checksum = storageMigrationChecksum(folderPath);
    if (entry.checksum !== checksum)
      failures.push(`${folder}: lock checksum does not match step files`);
    const files = checksumFiles(folderPath);
    const allFiles = readdirSync(folderPath, { recursive: true })
      .map(String)
      .filter((file) => statSync(resolve(folderPath, file)).isFile());
    if (!allFiles.some((file) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)))
      failures.push(`${folder}: migration step requires a test`);
    for (const file of files) {
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      if (/\bimport\s*\(\s*[^"'\s]/.test(source))
        failures.push(
          `${folder}/${normalize(relative(folderPath, file))}: non-literal dynamic imports are forbidden`,
        );
      for (const specifier of imports(source)) {
        const violation = forbiddenImports.find(([pattern]) =>
          pattern.test(specifier),
        );
        const forbiddenDependency = nodeBuiltins.has(specifier)
          ? "Node built-ins"
          : violation?.[1];
        if (forbiddenDependency)
          failures.push(
            `${folder}/${normalize(relative(folderPath, file))}: migration steps may not import ${forbiddenDependency}`,
          );
      }
    }
  }
  for (const id of byId.keys())
    if (!folders.includes(id))
      failures.push(`${id}: lock entry has no step folder`);

  const indexFile = resolve(stepsRoot, "index.ts");
  if (!existsSync(indexFile)) {
    failures.push("steps/index.ts: migration registry is missing");
  } else {
    const registered = [
      ...readFileSync(indexFile, "utf8").matchAll(
        /from\s+["']\.\/([^/]+)\/step\.js["']/g,
      ),
    ].map((match) => match[1]);
    const expected = locked.entries
      .filter((entry) => typeof entry?.id === "string")
      .map((entry) => entry.id);
    if (JSON.stringify(registered) !== JSON.stringify(expected))
      failures.push(
        "steps/index.ts: registry imports must exactly match lock order",
      );
  }

  if (baseRef === "main") {
    for (const entry of locked.entries)
      if (entry.stage === "draft")
        failures.push(`${entry.id}: draft migrations may not merge to main`);
  }

  const baseline = mainEntries(repoRoot);
  for (const entry of locked.entries) {
    const previous = baseline.get(entry.id);
    if (!previous || !["final", "released"].includes(previous.stage)) continue;
    if (entry.stage === "draft")
      failures.push(
        `${entry.id}: finalized migrations may not return to draft`,
      );
    const acceptedChecksums = Array.isArray(entry.acceptedChecksums)
      ? entry.acceptedChecksums
      : [];
    if (
      entry.checksum !== previous.checksum &&
      !acceptedChecksums.includes(previous.checksum)
    )
      failures.push(
        `${entry.id}: changed finalized migration must accept its previous checksum`,
      );
    const oldAccepted = Array.isArray(previous.acceptedChecksums)
      ? previous.acceptedChecksums
      : [];
    if (
      previous.stage === "released" &&
      acceptedChecksums.some((checksum) => !oldAccepted.includes(checksum))
    )
      failures.push(
        `${entry.id}: released migrations may not add accepted checksums`,
      );

    const folderPath = resolve(stepsRoot, entry.id);
    if (!existsSync(folderPath)) continue;
    for (const file of checksumFiles(folderPath)) {
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
      for (const specifier of imports(readFileSync(file, "utf8"))) {
        const match = /^\.\.\/\.\.\/kit\/(.+)$/.exec(specifier);
        if (!match) continue;
        const kitFile = `${STORAGE_MIGRATIONS_DIRECTORY}/kit/${match[1].replace(/\.js$/, ".ts")}`;
        const oldSource = gitMainFile(repoRoot, kitFile);
        if (
          oldSource !== undefined &&
          readFileSync(resolve(repoRoot, kitFile), "utf8") !== oldSource
        )
          failures.push(
            `${entry.id}: versioned kit dependency changed after finalization: ${kitFile}`,
          );
      }
    }
  }
  return failures.sort();
}
