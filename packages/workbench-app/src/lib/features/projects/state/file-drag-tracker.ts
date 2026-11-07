/**
 * Tracks whether an OS file drag is hovering the window. Enter/leave events
 * alone are unreliable (cancelled drags, drags released outside the window and
 * elements removed mid-drag can skip `dragleave`), and the drop overlay sits
 * over the frameless titlebar as `no-drag`, so a stuck "dragging" state would
 * silently disable window dragging. An idle watchdog bounds the state: browsers
 * fire `dragover` continuously while a drag is active.
 */
export type FileDragTracker = {
  enter(): void;
  leave(): void;
  /** Heartbeat from any `dragover` of the active drag. */
  over(): void;
  /** Drop, dragend, blur, Escape, or a leave that exits the window. */
  reset(): void;
  readonly active: boolean;
  dispose(): void;
};

export const FILE_DRAG_IDLE_MS = 1500;

export function createFileDragTracker(
  onChange: (active: boolean) => void,
  idleMs = FILE_DRAG_IDLE_MS,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): FileDragTracker {
  let depth = 0;
  let active = false;
  let watchdog: unknown;

  function arm() {
    if (watchdog !== undefined) timers.clear(watchdog);
    watchdog = timers.set(reset, idleMs);
  }

  function reset() {
    if (watchdog !== undefined) timers.clear(watchdog);
    watchdog = undefined;
    depth = 0;
    if (!active) return;
    active = false;
    onChange(false);
  }

  return {
    enter() {
      depth += 1;
      arm();
      if (active) return;
      active = true;
      onChange(true);
    },
    leave() {
      if (!active) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
    },
    over() {
      if (active) arm();
    },
    reset,
    get active() {
      return active;
    },
    dispose: reset,
  };
}
