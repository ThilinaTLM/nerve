import type { RevealFrameScheduler } from "./streaming-reveal-loop.js";

export type HeightMotionProfile = "standard" | "compact" | "minimal";

/** Spring response (≈99% settled) per motion profile; minimal never animates. */
export const HEIGHT_RESPONSE_MS: Record<HeightMotionProfile, number> = {
  standard: 280,
  compact: 160,
  minimal: 0,
};
/** At most this many heights animate at once; extra followers snap. */
export const MAX_ACTIVE_SPRINGS = 6;

/** (1 + x)e^-x = 0.01 at x ≈ 6.64: the spring is 99% there at responseMs. */
const RESPONSE_OMEGA_FACTOR = 6.64;
const SETTLE_DISTANCE_PX = 0.5;
const SETTLE_VELOCITY_PX_S = 5;
const MAX_STEP_MS = 50;

/**
 * Critically damped spring over a height. Retargeting keeps position and
 * velocity, so steps arriving close together blend into one continuous
 * motion, and critical damping never overshoots. Pure and clock-free.
 */
export class HeightSpring {
  private value: number;
  private velocity = 0;
  private goal: number;

  constructor(height: number) {
    this.value = height;
    this.goal = height;
  }

  get height(): number {
    return this.value;
  }

  get target(): number {
    return this.goal;
  }

  get settled(): boolean {
    return this.value === this.goal && this.velocity === 0;
  }

  retarget(target: number): void {
    this.goal = target;
  }

  snap(target = this.goal): void {
    this.goal = target;
    this.value = target;
    this.velocity = 0;
  }

  /** Advance one frame; returns true once settled at the target. */
  step(dtMs: number, responseMs: number): boolean {
    if (this.settled) return true;
    if (responseMs <= 0) {
      this.snap();
      return true;
    }
    // Exact critically damped solution over dt: frame-rate independent and
    // unconditionally stable, unlike explicit integration.
    const t = Math.min(Math.max(0, dtMs), MAX_STEP_MS) / 1000;
    const omega = RESPONSE_OMEGA_FACTOR / (responseMs / 1000);
    const offset = this.value - this.goal;
    const coefficient = this.velocity + omega * offset;
    const decay = Math.exp(-omega * t);
    this.value = this.goal + (offset + coefficient * t) * decay;
    this.velocity = (this.velocity - omega * coefficient * t) * decay;
    if (
      Math.abs(this.goal - this.value) < SETTLE_DISTANCE_PX &&
      Math.abs(this.velocity) < SETTLE_VELOCITY_PX_S
    ) {
      this.snap();
      return true;
    }
    return false;
  }
}

export type SpringDriverClient = {
  /** Advance one frame; return true when finished. */
  step(dtMs: number): boolean;
};

export type SpringDriver = {
  /** Start driving a client; false when the concurrency cap is reached. */
  add(client: SpringDriverClient): boolean;
  remove(client: SpringDriverClient): void;
  readonly activeCount: number;
};

const FALLBACK_FRAME_MS = 1000 / 60;

/**
 * One frame loop for every animating spring, bounded by `maxActive`. Runs
 * only while at least one client is active.
 */
export function createSpringDriver<Handle = number>(options: {
  frames: RevealFrameScheduler<Handle>;
  maxActive?: number;
}): SpringDriver {
  const maxActive = options.maxActive ?? MAX_ACTIVE_SPRINGS;
  const clients = new Set<SpringDriverClient>();
  let frame: Handle | undefined;
  let lastTimestamp: number | undefined;

  function schedule(): void {
    if (frame !== undefined || clients.size === 0) return;
    frame = options.frames.request(step);
  }

  function step(timestamp: number): void {
    frame = undefined;
    const dt =
      lastTimestamp === undefined
        ? FALLBACK_FRAME_MS
        : timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    for (const client of [...clients]) {
      if (client.step(dt)) clients.delete(client);
    }
    if (clients.size === 0) {
      lastTimestamp = undefined;
      return;
    }
    schedule();
  }

  return {
    add(client) {
      if (clients.has(client)) return true;
      if (clients.size >= maxActive) return false;
      clients.add(client);
      schedule();
      return true;
    },
    remove(client) {
      clients.delete(client);
      if (clients.size > 0 || frame === undefined) return;
      options.frames.cancel(frame);
      frame = undefined;
      lastTimestamp = undefined;
    },
    get activeCount() {
      return clients.size;
    },
  };
}

let shared: SpringDriver | undefined;

/** Process-wide driver on requestAnimationFrame; undefined without rAF. */
export function sharedSpringDriver(): SpringDriver | undefined {
  if (shared) return shared;
  if (typeof requestAnimationFrame !== "function") return undefined;
  shared = createSpringDriver({
    frames: {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    },
  });
  return shared;
}
