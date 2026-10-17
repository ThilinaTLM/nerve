import { readLines, serializeRecord } from "./json-lines.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { atomicWriteJson } from "../../storage-bootstrap/json.js";
import {
  DiscardableMigrationError,
  type DiscardableItem,
  type StepContext,
} from "./step.js";

export interface QuarantinePayload {
  /** Archive damaged records without claiming the whole owning unit was set aside. */
  setAside?: boolean;
  files?: readonly string[];
  /** Trusted source directory for files outside the home (for example a registered project). */
  root?: string;
  records?: Iterable<unknown>;
}
export interface UnitOptions {
  transaction?<T>(action: () => Promise<T>): Promise<T>;
  checkpoint?(): () => void;
  quarantine?: QuarantinePayload;
}
export interface ToolkitState {
  phase: string;
  dependencies: Record<string, string[]>;
  checkedText: Map<string, string>;
  discardedDetails: DiscardableItem[];
  failures: DiscardableItem[];
  owned: Map<string, string>;
  unit?: Omit<DiscardableItem, "reason">;
  pending: Array<() => void>;
  setAside: Array<DiscardableItem & { quarantinePath: string }>;
  losses: Array<{ reason: string; count: number }>;
}
const states = new WeakMap<StepContext, ToolkitState>();
const boundedReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .split("\n")[0]
    .slice(0, 300);
export function toolkitState(ctx: StepContext): ToolkitState {
  const state = states.get(ctx);
  assert(state, "Migration toolkit not initialized");
  return state;
}
export function initializeToolkit(ctx: StepContext): void {
  let report: Pick<ToolkitState, "setAside" | "losses"> = {
    setAside: [],
    losses: [],
  };
  const path = join(ctx.scratchDir, "upgrade-report.json");
  if (existsSync(path)) report = JSON.parse(readFileSync(path, "utf8"));
  states.set(ctx, {
    phase: "plan",
    dependencies: existsSync(join(ctx.scratchDir, "unit-dependencies.json"))
      ? JSON.parse(
          readFileSync(join(ctx.scratchDir, "unit-dependencies.json"), "utf8"),
        )
      : {},
    checkedText: new Map(),
    discardedDetails: existsSync(join(ctx.scratchDir, "discarded-details.json"))
      ? JSON.parse(
          readFileSync(join(ctx.scratchDir, "discarded-details.json"), "utf8"),
        )
      : [],
    failures: [],
    owned: new Map(),
    pending: [],
    ...report,
  });
}
export function startPhase(ctx: StepContext, phase: string): void {
  const state = toolkitState(ctx);
  state.phase = phase;
  state.failures = [];
  ctx.fs.readOnly = phase === "check";
}
export function includeFailures(
  ctx: StepContext,
  items: DiscardableItem[],
): void {
  const state = toolkitState(ctx);
  const merged = new Map<string, DiscardableItem>();
  for (const item of [...items, ...state.failures])
    if (!merged.has(`${item.kind}:${item.id}`))
      merged.set(`${item.kind}:${item.id}`, item);
  state.failures = [...merged.values()];
}
export function finishPhase(ctx: StepContext): void {
  const state = toolkitState(ctx);
  if (state.failures.length)
    throw new DiscardableMigrationError(state.failures);
}
export function applyQuarantine(ctx: StepContext): void {
  const state = toolkitState(ctx);
  ctx.fs.readOnly = false;
  for (const apply of state.pending.splice(0)) apply();
}
export function ownPaths(
  ctx: StepContext,
  paths: readonly string[],
  root = ctx.paths.home,
): void {
  const boundary = resolve(root);
  for (const path of paths) {
    const owned = resolve(path);
    const rel = relative(boundary, owned);
    assert(
      rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`),
      `Owned path is outside its declared root: ${owned}`,
    );
    toolkitState(ctx).owned.set(owned, boundary);
  }
}
export function checkedJson<T>(
  ctx: StepContext,
  path: string,
  schema: { parse(value: unknown): T },
): T | undefined {
  const state = toolkitState(ctx);
  path = resolve(path);
  assert(state.owned.has(path), `Migration does not own ${path}`);
  try {
    const boundary = state.owned.get(path)!;
    for (
      let entry = path;
      entry !== dirname(entry) && relative(boundary, entry) !== "";
      entry = dirname(entry)
    )
      assert(
        !lstatSync(entry).isSymbolicLink(),
        `Owned JSON path traverses a symbolic link: ${entry}`,
      );
    const text = readFileSync(path, "utf8");
    state.checkedText.set(path, text);
    return schema.parse(JSON.parse(text));
  } catch (error) {
    if (state.unit) throw error;
    state.failures.push({
      kind: "configuration",
      id: path,
      reason: boundedReason(error),
    });
    return undefined;
  }
}
export async function runUnit<T>(
  ctx: StepContext,
  item: Omit<DiscardableItem, "reason">,
  fn: () => T | Promise<T>,
  options: UnitOptions = {},
): Promise<T | undefined> {
  const state = toolkitState(ctx);
  assert(!state.unit, "Nested migration units are not supported");
  if (ctx.discarded.has(item.id)) {
    if (options.quarantine)
      quarantine(
        ctx,
        {
          ...item,
          reason: "Set aside at user request after an upgrade failure",
        },
        options.quarantine,
      );
    return;
  }
  const files = ctx.fs.beginUnit();
  const undoReport = options.checkpoint?.();
  const saved = structuredClone({
    setAside: state.setAside,
    losses: state.losses,
  });
  state.unit = item;
  let result: T;
  try {
    const action = async () => fn();
    result = options.transaction
      ? await options.transaction(action)
      : await action();
  } catch (error) {
    files.finish(false);
    undoReport?.();
    Object.assign(state, saved);
    state.failures.push({ ...item, reason: boundedReason(error) });
    return undefined;
  } finally {
    state.unit = undefined;
  }
  // A failure after the transaction returned is home-wide: its commit cannot
  // be undone by pretending this was an isolated, discardable unit failure.
  files.finish(true);
  return result;
}
function quarantineSource(
  ctx: StepContext,
  path: string,
  root?: string,
): string {
  path = resolve(path);
  const boundary = resolve(root ?? ctx.paths.home);
  const rel = relative(boundary, path);
  assert(
    rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`),
    `Quarantine source is outside its declared root: ${path}`,
  );
  let current = boundary;
  for (const part of relative(boundary, path).split(sep)) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) return path;
    if (stat.isSymbolicLink()) return current;
  }
  return path;
}
export function quarantine(
  ctx: StepContext,
  item: DiscardableItem,
  payload: QuarantinePayload,
): string {
  const state = toolkitState(ctx);
  const original = state.discardedDetails.find(
    (entry) => entry.kind === item.kind && entry.id === item.id,
  );
  if (original) item = original;
  const source = basename(ctx.scratchDir);
  const hash = createHash("sha256")
    .update(`${item.kind}:${item.id}`)
    .digest("hex")
    .slice(0, 12);
  const name = `${item.kind}-${item.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(-64)}-${hash}`;
  const path = join(ctx.paths.home, "quarantine", source, name);
  const apply = () => {
    // Quarantine is framework-owned infrastructure, not a source symlink that
    // may be followed. Refuse an altered destination before any read or write.
    for (const destination of [
      path,
      join(path, "payload"),
      join(path, "reason.json"),
      join(path, "payload", "records.jsonl"),
    ]) {
      let current = resolve(ctx.paths.home);
      for (const part of relative(current, destination).split(sep)) {
        current = join(current, part);
        const stat = lstatSync(current, { throwIfNoEntry: false });
        if (!stat) break;
        assert(
          !stat.isSymbolicLink(),
          `Quarantine destination traverses a symbolic link: ${current}`,
        );
      }
    }
    ctx.fs.mkdir(path);
    ctx.fs.mkdir(join(path, "payload"));
    const sources = (payload.files ?? []).map((file) =>
      quarantineSource(ctx, file, payload.root),
    );
    const reasonPath = join(path, "reason.json");
    if (!existsSync(reasonPath))
      ctx.fs.write(
        reasonPath,
        JSON.stringify(
          {
            ...item,
            ...(sources.length === 1 ? { originalPath: sources[0] } : {}),
            quarantinedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    if (payload.records) {
      const recordsPath = join(path, "payload", "records.jsonl");
      function* lines(): Generator<string> {
        const seen = new Set<string>();
        for (const line of readLines(recordsPath)) {
          seen.add(createHash("sha256").update(line).digest("hex"));
          yield `${line}\n`;
        }
        for (const row of payload.records ?? []) {
          const line = serializeRecord(row);
          const hash = createHash("sha256").update(line).digest("hex");
          if (seen.has(hash)) continue;
          seen.add(hash);
          yield `${line}\n`;
        }
      }
      ctx.fs.writeChunks(recordsPath, lines());
    }
    for (const file of sources) {
      const destination = join(path, "payload", basename(file));
      if (!lstatSync(file, { throwIfNoEntry: false })) continue;
      ctx.fs.move(file, destination);
    }
    if (
      payload.setAside !== false &&
      !state.setAside.some(
        (entry) => entry.id === item.id && entry.kind === item.kind,
      )
    )
      state.setAside.push({ ...item, quarantinePath: path });
    ctx.fs.write(
      join(ctx.scratchDir, "upgrade-report.json"),
      JSON.stringify({ setAside: state.setAside, losses: state.losses }),
    );
  };
  if (state.phase === "check") state.pending.push(apply);
  else apply();
  return path;
}
export function recordLoss(ctx: StepContext, reason: string, count = 1): void {
  assert(Number.isSafeInteger(count) && count >= 0);
  assert(!ctx.fs.readOnly, "The migration check phase is read-only");
  const state = toolkitState(ctx);
  const loss = state.losses.find((entry) => entry.reason === reason);
  if (loss) loss.count += count;
  else state.losses.push({ reason, count });
  ctx.fs.write(
    join(ctx.scratchDir, "upgrade-report.json"),
    JSON.stringify({ setAside: state.setAside, losses: state.losses }),
  );
}
export async function writeUpgradeReport(
  ctx: StepContext,
  step: string,
  description: string,
): Promise<void> {
  const { setAside, losses } = toolkitState(ctx);
  if (!setAside.length && !losses.length) return;
  await atomicWriteJson(
    join(ctx.paths.home, "migrations", "reports", `${step}.json`),
    {
      step,
      description,
      completedAt: new Date().toISOString(),
      setAside,
      losses,
    },
    0o600,
  );
}

/** Commit receipts replace the summary atomically, so cleanup retries cannot double-count. */
export function replaceLosses(
  ctx: StepContext,
  losses: ToolkitState["losses"],
): void {
  const state = toolkitState(ctx);
  state.losses = losses;
  ctx.fs.write(
    join(ctx.scratchDir, "upgrade-report.json"),
    JSON.stringify({ setAside: state.setAside, losses }),
  );
}

export function checkedText(
  ctx: StepContext,
  path: string,
): string | undefined {
  return toolkitState(ctx).checkedText.get(resolve(path));
}

export function dependentUnits(
  ctx: StepContext,
  parent: string,
  children: string[],
): void {
  toolkitState(ctx).dependencies[parent] = children;
}
