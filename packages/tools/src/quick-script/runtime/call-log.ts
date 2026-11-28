import type {
  QuickScriptHostCall,
  QuickScriptLiveCall,
} from "@nervekit/contracts/tools";
import type { MethodRisk } from "./sdk-types.js";

/** One SDK call a script started; `call` is set when it finished. */
export type CallEntry = {
  seq: number;
  method: string;
  startedAt: number;
  /** Declared risk of the method; unset for unknown methods. */
  risk?: MethodRisk;
  /** Fields known once the call is prepared (summary, targets, ...). */
  known: Partial<QuickScriptHostCall>;
  call?: QuickScriptHostCall;
};

/**
 * Display fields a method attaches to the value it returns (`files.edit`'s diff
 * statistics); the executor copies them onto the call's record for the tool card.
 */
export const callDetails = new WeakMap<object, Partial<QuickScriptHostCall>>();

const READ_RISKS: readonly MethodRisk[] = ["none", "read", "external_read"];
const MAX_LISTED = 10;
const MAX_ERROR_CHARS = 150;
export const ABORTED_ERROR = "aborted when the script ended before it finished";

/** Whether the method can change something, so a call without a known result may have taken effect. */
export function canChange(entry: CallEntry): boolean {
  return entry.risk !== undefined && !READ_RISKS.includes(entry.risk);
}

/**
 * Records the calls of one run in start order. Once sealed, late settlements and
 * live events are ignored, so a result that was already built cannot change.
 */
export class CallLog {
  readonly entries: CallEntry[] = [];
  private sealed = false;

  constructor(private readonly send: (event: QuickScriptLiveCall) => void) {}

  get isSealed(): boolean {
    return this.sealed;
  }

  begin(method: string): CallEntry {
    const entry: CallEntry = {
      seq: this.entries.length,
      method,
      startedAt: performance.now(),
      known: {},
    };
    this.entries.push(entry);
    return entry;
  }

  emitStarted(entry: CallEntry): void {
    if (this.sealed) return;
    this.send({
      phase: "started",
      seq: entry.seq,
      method: entry.method,
      ...(entry.known.summary ? { summary: entry.known.summary } : {}),
    });
  }

  finish(
    entry: CallEntry,
    fields: Pick<QuickScriptHostCall, "outcome"> & Partial<QuickScriptHostCall>,
  ): void {
    if (this.sealed || entry.call) return;
    const call: QuickScriptHostCall = {
      method: entry.method,
      ...entry.known,
      ...fields,
      durationMs: Math.round(performance.now() - entry.startedAt),
    };
    entry.call = call;
    this.send({
      phase: "finished",
      seq: entry.seq,
      method: entry.method,
      ...(call.summary ? { summary: call.summary } : {}),
      outcome: call.outcome,
      ...(call.error ? { error: truncate(call.error, 300) } : {}),
      durationMs: call.durationMs,
    });
  }

  /** Calls that have not finished yet. */
  running(): CallEntry[] {
    return this.entries.filter((entry) => !entry.call);
  }

  /** Records every call that never finished as aborted, then ignores all later changes. Returns copies in start order. */
  seal(): QuickScriptHostCall[] {
    for (const entry of this.running()) {
      this.finish(entry, { outcome: "failed", error: ABORTED_ERROR });
    }
    this.sealed = true;
    return this.entries.map((entry) => ({ ...entry.call! }));
  }
}

const label = (entry: CallEntry) =>
  entry.known.summary
    ? `${entry.method} (${entry.known.summary})`
    : entry.method;

function capped(items: string[]): string {
  const more = items.length - MAX_LISTED;
  return `${items.slice(0, MAX_LISTED).join("; ")}${more > 0 ? `; +${more} more` : ""}`;
}

/**
 * Report lines for calls that were still running when the script ended (`unfinished`, taken before the abort) and for failed calls that can change something.
 * Call after `seal`.
 */
export function callOutcomeLines(
  unfinished: readonly CallEntry[],
  entries: readonly CallEntry[],
  scriptCompleted: boolean,
): string[] {
  const lines: string[] = [];
  if (unfinished.length > 0) {
    const items = unfinished.map((entry) => {
      if (!canChange(entry)) return label(entry);
      return entry.call?.outcome === "completed"
        ? `${label(entry)}, completed after the script ended`
        : `${label(entry)}, outcome unknown`;
    });
    lines.push(
      `Still running when the script ended, aborted: ${capped(items)}${scriptCompleted ? ". Await every call." : "."}`,
    );
  }
  const ended = new Set(unfinished);
  const failed = entries
    .filter(
      (entry) =>
        !ended.has(entry) &&
        canChange(entry) &&
        entry.call?.outcome === "failed",
    )
    .map(
      (entry) =>
        `${label(entry)}: ${truncate(entry.call?.error ?? "failed", MAX_ERROR_CHARS)}`,
    );
  if (failed.length > 0) lines.push(`Failed: ${capped(failed)}`);
  return lines;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
