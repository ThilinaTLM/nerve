import {
  cp,
  lstat,
  mkdir,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertSlotPaths,
  createSlotParent,
} from "../development/storage-slot.mjs";
import { acquireStorageHomeLock } from "../../packages/workbench-server/src/infrastructure/storage-bootstrap/home-lock.js";
import { cloneNerveHome } from "./home-operations.js";
import { redirectProject, rehearseOptions } from "./rehearse-options.js";
import { writeRehearsalBaseline } from "./rehearse-baseline.js";
async function list(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink ${child}`);
    if (entry.isDirectory()) result.push(...(await list(child)));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}
try {
  const options = rehearseOptions(process.argv.slice(2));
  options.source = await realpath(options.source);
  const { slot } = options;
  const projects = join(slot.data, `storage-${slot.slot}-projects`);
  await createSlotParent(slot);
  const existing = await lstat(slot.home).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    },
  );
  if (existing && !options.forceReset)
    throw new Error(
      "Slot exists; use --force-reset only for a stopped disposable slot",
    );
  if (
    slot.home.startsWith(`${options.source}/`) ||
    projects.startsWith(`${options.source}/`) ||
    options.source === slot.home ||
    options.source.startsWith(`${slot.home}/`) ||
    options.source === projects ||
    options.source.startsWith(`${projects}/`)
  )
    throw new Error("Source overlaps rehearsal destination");
  const projectEntry = await lstat(projects).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    },
  );
  if (
    projectEntry &&
    (!projectEntry.isDirectory() || projectEntry.isSymbolicLink())
  )
    throw new Error(`Unsafe project destination ${projects}`);
  if (projectEntry && !options.forceReset)
    throw new Error(
      `Project destination exists: ${projects}; use --force-reset`,
    );
  if (options.forceReset) {
    const lock = await acquireStorageHomeLock(slot.home, { timeoutMs: 0 });
    try {
      await assertSlotPaths(slot);
      await rm(slot.home, { recursive: true, force: true });
      await rm(projects, { recursive: true, force: true });
    } finally {
      await lock.release();
    }
  }
  await cloneNerveHome({ source: options.source, destination: slot.home });
  await mkdir(projects, { mode: 0o700 });
  const db = new DatabaseSync(join(slot.home, "data/nerve.sqlite"));
  try {
    const used = new Map<string, string>();
    for (const row of db
      .prepare(
        "SELECT rowid, data FROM domain_documents WHERE namespace = 'project' ORDER BY rowid",
      )
      .all()) {
      const document = JSON.parse(
        Buffer.from(row.data as Uint8Array).toString(),
      ) as Record<string, unknown>;
      const redirected = redirectProject(document, projects);
      const previous = used.get(redirected.destination);
      if (previous && previous !== redirected.source)
        throw new Error(
          "Project basename collision; refusing ambiguous redirect",
        );
      if (!previous) {
        await mkdir(redirected.destination, { mode: 0o700 });
        const source = join(redirected.source, ".nerve");
        const entry = await lstat(source).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
            return undefined;
          },
        );
        if (entry) {
          if (!entry.isDirectory() || entry.isSymbolicLink())
            throw new Error(`Unsafe project configuration ${source}`);
          await list(source); // Reject nested links before copying.
          await cp(source, join(redirected.destination, ".nerve"), {
            recursive: true,
            dereference: false,
          });
        }
        used.set(redirected.destination, redirected.source);
      }
      db.prepare("UPDATE domain_documents SET data = ? WHERE rowid = ?").run(
        Buffer.from(JSON.stringify(redirected.document)),
        row.rowid!,
      );
    }
    const preset = options.corrupt;
    if (preset === "conversation" || preset === "message") {
      const table =
        preset === "conversation" ? "domain_documents" : "conversation_records";
      const condition =
        preset === "conversation"
          ? "namespace = 'conversation'"
          : "kind = 'message'";
      const result = db
        .prepare(
          `UPDATE ${table} SET data = ? WHERE rowid = (SELECT rowid FROM ${table} WHERE ${condition} ORDER BY rowid LIMIT 1)`,
        )
        .run(Buffer.from("garbage"));
      if (!result.changes) throw new Error(`No input for preset ${preset}`);
    }
  } finally {
    db.close();
  }
  const preset = options.corrupt;
  if (preset && !["conversation", "message"].includes(preset)) {
    const candidates = (await list(slot.home)).filter((path) => {
      const name = relative(slot.home, path);
      if (preset === "overlay")
        return /^data\/conversations\/.*\/(capabilities|permissions)\.json$/.test(
          name,
        );
      if (preset.startsWith("runtime-"))
        return /^config\/(daemon|harness|ui|permissions|providers|integrations)\.json$/.test(
          name,
        );
      return (
        /^config\/.+\.json$/.test(name) &&
        !/^config\/(daemon|harness|ui|permissions|providers|integrations)\.json$/.test(
          name,
        )
      );
    });
    if (!candidates[0]) throw new Error(`No input for preset ${preset}`);
    await writeFile(candidates[0], preset === "runtime-shape" ? "[]" : '{"');
    console.log(`Corrupted ${candidates[0]}`);
  }
  const checksum = join(slot.data, `storage-${slot.slot}-baseline.sha`);
  await writeRehearsalBaseline(slot.home, projects, checksum);
  console.log(
    `Next: pnpm dev --slot ${slot.slot}\nUse the recovery UI to restore, stop the daemon, then verify:\nsha256sum -c '${checksum}'\nOr migrate offline: pnpm storage:migrate --home '${slot.home}'`,
  );
  console.warn(
    "Copied credentials can access real providers. Projects contain only .nerve, not working trees.",
  );
  if (!options.keep)
    console.log(
      `After rehearsal, remove disposable files: rm -rf '${slot.home}' '${projects}' '${checksum}'`,
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
