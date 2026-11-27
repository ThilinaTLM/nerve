/**
 * The bell island's state, as pure transitions: what is arriving, what waits
 * in line, and whether the user folded it away with Later. Two levels wait for
 * the user: configuration that needs their trust (`trust`, warning) and
 * conversations that wait for an answer (`conversation`, info). Trust always
 * comes first.
 */

import type { IslandLevel } from "$lib/presentation/activity/attention-island";

export type { IslandLevel };

export type IslandArrival = { level: IslandLevel; key: string };

/**
 * - `arrival`: one new item shows on one line, then settles.
 * - `compact`: the bell with the count of the highest level waiting.
 * - `expanded`: the lists.
 * - `later`: hidden, with the transcript marker, until a new trust item arrives.
 */
export type IslandPhase = "arrival" | "compact" | "expanded" | "later";

export type IslandState = {
  phase: IslandPhase;
  arrival?: IslandArrival;
  /** Arrivals waiting their turn, trust first; they never stack. */
  queue: readonly IslandArrival[];
  /** Bumped on every trust arrival: the transcript marker pulses again. */
  trustArrivals: number;
  seenTrust: ReadonlySet<string>;
  seenConversations: ReadonlySet<string>;
  /** Trust scopes (projects, or "" for none) whose first read was recorded quietly. */
  trustBaselines: ReadonlySet<string>;
  conversationsBaselined: boolean;
};

export function initialIslandState(): IslandState {
  return {
    phase: "compact",
    queue: [],
    trustArrivals: 0,
    seenTrust: new Set(),
    seenConversations: new Set(),
    trustBaselines: new Set(),
    conversationsBaselined: false,
  };
}

const trustFirst = (a: IslandArrival, b: IslandArrival) =>
  Number(a.level !== "trust") - Number(b.level !== "trust");

function show(state: IslandState, next: IslandArrival): IslandState {
  return {
    ...state,
    phase: "arrival",
    arrival: next,
    trustArrivals: state.trustArrivals + (next.level === "trust" ? 1 : 0),
  };
}

/** The current arrival is done: the next one in line shows, else the bell. */
export function settleIsland(state: IslandState): IslandState {
  if (state.phase !== "arrival") return state;
  const [next, ...rest] = state.queue;
  if (!next) return { ...state, phase: "compact", arrival: undefined };
  return show({ ...state, queue: rest }, next);
}

/** Queues arrivals. Later lets only trust through; the open list shows them anyway. */
function enqueueArrivals(
  state: IslandState,
  arrivals: readonly IslandArrival[],
): IslandState {
  if (state.phase === "expanded") return state;
  const admitted =
    state.phase === "later"
      ? arrivals.filter((arrival) => arrival.level === "trust")
      : arrivals;
  if (!admitted.length) return state;
  const queue = [...state.queue, ...admitted].sort(trustFirst);
  if (state.phase === "arrival") return { ...state, queue };
  const [next, ...rest] = queue;
  return show({ ...state, queue: rest }, next!);
}

/**
 * Records the trust items read for one scope. The first read of a scope is
 * what was already waiting (startup, switching projects): quiet. Keys never
 * seen before arrive.
 */
export function observeTrust(
  state: IslandState,
  scope: string,
  keys: readonly string[],
): IslandState {
  const seenTrust = new Set(state.seenTrust);
  const fresh = keys.filter((key) => !seenTrust.has(key));
  for (const key of keys) seenTrust.add(key);
  if (!state.trustBaselines.has(scope))
    return {
      ...state,
      seenTrust,
      trustBaselines: new Set([...state.trustBaselines, scope]),
    };
  if (!fresh.length) return state;
  return enqueueArrivals(
    { ...state, seenTrust },
    fresh.map((key) => ({ level: "trust" as const, key })),
  );
}

export type IslandConversationKey = { key: string; conversationId: string };

/**
 * Records the conversations waiting for the user. The first read is quiet; the
 * conversation already open never arrives, and an item arrives only once.
 */
export function observeConversations(
  state: IslandState,
  items: readonly IslandConversationKey[],
  openConversationId: string | undefined,
): IslandState {
  const seenConversations = new Set(state.seenConversations);
  const fresh = items.filter((item) => !seenConversations.has(item.key));
  for (const item of items) seenConversations.add(item.key);
  if (!state.conversationsBaselined)
    return { ...state, seenConversations, conversationsBaselined: true };
  if (!fresh.length) return state;
  return enqueueArrivals(
    { ...state, seenConversations },
    fresh
      .filter((item) => item.conversationId !== openConversationId)
      .map((item) => ({ level: "conversation" as const, key: item.key })),
  );
}

/** Drops arrivals for items that no longer wait (decided, answered). */
export function pruneIsland(
  state: IslandState,
  present: { trust: ReadonlySet<string>; conversations: ReadonlySet<string> },
): IslandState {
  const waiting = (arrival: IslandArrival) =>
    (arrival.level === "trust" ? present.trust : present.conversations).has(
      arrival.key,
    );
  const queue = state.queue.filter(waiting);
  const next = { ...state, queue };
  if (state.arrival && !waiting(state.arrival))
    return settleIsland({ ...next, phase: "arrival" });
  return queue.length === state.queue.length ? state : next;
}

export function expandIsland(state: IslandState): IslandState {
  return { ...state, phase: "expanded", arrival: undefined, queue: [] };
}

export function collapseIsland(state: IslandState): IslandState {
  return state.phase === "expanded" ? { ...state, phase: "compact" } : state;
}

/** Hides the island and the marker until a new trust item arrives. */
export function laterIsland(state: IslandState): IslandState {
  return { ...state, phase: "later", arrival: undefined, queue: [] };
}

/** The island replaces the bell while anything waits, unless folded away. */
export function islandShown(
  state: IslandState,
  counts: { trust: number; conversations: number },
): boolean {
  return state.phase !== "later" && counts.trust + counts.conversations > 0;
}

/** The transcript marker shows trust items only. */
export function markerShown(state: IslandState, trustCount: number): boolean {
  return state.phase !== "later" && trustCount > 0;
}
