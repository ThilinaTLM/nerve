import { bridgeLimits, type BridgeJson } from "@nervekit/contracts/extensions";

type Entry = { state: BridgeJson; at: number };
export type ViewStateStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "nerve:extension-view-state:v1";
/** Frames remembered; the least recently written drops first. */
export const maxViewStateEntries = 40;

/** The key of one frame's state: tab or panel identity, so each tab restores its own. */
export function viewStateKey(parts: {
  projectId: string;
  extensionId: string;
  kind: string;
  contributionId: string;
  instance: string;
}): string {
  return [
    parts.projectId,
    parts.extensionId,
    parts.kind,
    parts.contributionId,
    parts.instance,
  ].join("|");
}

/**
 * The `viewState` frames persist with their tab or panel. Kept in local storage beside the
 * other view preferences, bounded in entries and (by the bridge limit) in size per entry.
 */
export class ViewStateStore {
  private entries: Record<string, Entry>;

  constructor(private readonly storage: ViewStateStorage | undefined) {
    this.entries = this.load();
  }

  private load(): Record<string, Entry> {
    try {
      const parsed: unknown = JSON.parse(
        this.storage?.getItem(STORAGE_KEY) ?? "null",
      );
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, Entry] =>
            !!entry[1] &&
            typeof entry[1] === "object" &&
            typeof (entry[1] as Entry).at === "number" &&
            "state" in entry[1],
        ),
      );
    } catch {
      return {};
    }
  }

  get(key: string): BridgeJson | null {
    return this.entries[key]?.state ?? null;
  }

  /** Returns `false` when the state exceeds the size limit and was not stored. */
  set(key: string, state: BridgeJson, now = Date.now()): boolean {
    const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
    if (bytes > bridgeLimits.maxViewStateBytes) return false;
    this.entries[key] = { state, at: now };
    const keys = Object.keys(this.entries).sort(
      (a, b) => this.entries[a].at - this.entries[b].at,
    );
    for (const stale of keys.slice(
      0,
      Math.max(0, keys.length - maxViewStateEntries),
    ))
      delete this.entries[stale];
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // The in-memory state still serves this session.
    }
    return true;
  }

  remove(key: string): void {
    if (!(key in this.entries)) return;
    delete this.entries[key];
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // Best effort.
    }
  }
}
