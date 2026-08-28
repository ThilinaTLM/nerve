import type { Action } from "svelte/action";

export type ScrollPosition = {
  path: readonly number[];
  signature: string;
  ordinal: number;
  top: number;
  left: number;
};

export class CenterTabScrollSnapshotStore {
  readonly #snapshots = new Map<string, Map<string, ScrollPosition>>();

  positions(tabKey: string): readonly ScrollPosition[] {
    return [...(this.#snapshots.get(tabKey)?.values() ?? [])];
  }

  record(tabKey: string, position: ScrollPosition): void {
    let tabSnapshot = this.#snapshots.get(tabKey);
    if (!tabSnapshot) {
      tabSnapshot = new Map();
      this.#snapshots.set(tabKey, tabSnapshot);
    }
    tabSnapshot.set(positionKey(position), {
      ...position,
      path: [...position.path],
    });
  }

  prune(openTabKeys: ReadonlySet<string>): void {
    for (const tabKey of this.#snapshots.keys()) {
      if (!openTabKeys.has(tabKey)) this.#snapshots.delete(tabKey);
    }
  }

  clear(): void {
    this.#snapshots.clear();
  }
}

const scrollSnapshots = new CenterTabScrollSnapshotStore();
const SCROLLPORT_SELECTOR = [
  '[data-slot="scroll-area-viewport"]',
  ".virtual-scroller-viewport",
  ".cm-scroller",
  "[data-center-scrollport]",
].join(",");
const RESTORE_FRAME_LIMIT = 24;
let pruneTimer: ReturnType<typeof setTimeout> | undefined;

function positionKey(position: Pick<ScrollPosition, "path">): string {
  return position.path.join(".");
}

function elementSignature(element: HTMLElement): string {
  const slot = element.dataset.slot;
  if (slot) return `slot:${slot}`;
  if (element.classList.contains("virtual-scroller-viewport")) {
    return `virtual:${element.getAttribute("aria-label") ?? ""}`;
  }
  if (element.classList.contains("cm-scroller")) return "codemirror";
  const explicit = element.dataset.centerScrollport;
  if (explicit !== undefined) return `explicit:${explicit}`;
  return `${element.tagName.toLowerCase()}:${element.getAttribute("role") ?? ""}:${element.getAttribute("aria-label") ?? ""}`;
}

function elementPath(
  root: HTMLElement,
  element: HTMLElement,
): number[] | undefined {
  const path: number[] = [];
  let current: HTMLElement | null = element;
  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return undefined;
    const index = Array.prototype.indexOf.call(parent.children, current);
    if (index < 0) return undefined;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : undefined;
}

function elementAtPath(
  root: HTMLElement,
  path: readonly number[],
): HTMLElement | undefined {
  let current: HTMLElement = root;
  for (const index of path) {
    const child = current.children.item(index);
    if (!(child instanceof HTMLElement)) return undefined;
    current = child;
  }
  return current;
}

function scrollports(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(SCROLLPORT_SELECTOR)];
}

function snapshotForElement(
  root: HTMLElement,
  element: HTMLElement,
): ScrollPosition | undefined {
  const path = elementPath(root, element);
  if (!path) return undefined;
  const signature = elementSignature(element);
  const matching = scrollports(root).filter(
    (candidate) => elementSignature(candidate) === signature,
  );
  return {
    path,
    signature,
    ordinal: Math.max(0, matching.indexOf(element)),
    top: element.scrollTop,
    left: element.scrollLeft,
  };
}

function resolveScrollport(
  root: HTMLElement,
  position: ScrollPosition,
): HTMLElement | undefined {
  const exact = elementAtPath(root, position.path);
  if (exact && elementSignature(exact) === position.signature) return exact;
  return scrollports(root).filter(
    (candidate) => elementSignature(candidate) === position.signature,
  )[position.ordinal];
}

type RetainCenterTabScrollOptions = {
  tabKey: string;
  active: boolean;
};

export const retainCenterTabScroll: Action<
  HTMLElement,
  RetainCenterTabScrollOptions
> = (root, options) => {
  const { tabKey } = options;
  let active = options.active;
  let restoring = active && scrollSnapshots.positions(tabKey).length > 0;
  let restoreFrame: number | undefined;
  let restoreAttempts = 0;
  let stableFrames = 0;
  let destroyed = false;

  const stopRestore = () => {
    restoring = false;
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
    restoreFrame = undefined;
  };

  const restore = () => {
    restoreFrame = undefined;
    if (destroyed || !restoring) return;
    restoreAttempts += 1;
    const positions = scrollSnapshots.positions(tabKey);
    let complete = positions.length > 0;
    let alreadyRestored = true;

    for (const position of positions) {
      const element = resolveScrollport(root, position);
      if (!element) {
        complete = false;
        alreadyRestored = false;
        continue;
      }
      if (
        Math.abs(element.scrollTop - position.top) > 1 ||
        Math.abs(element.scrollLeft - position.left) > 1
      ) {
        alreadyRestored = false;
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    }

    stableFrames = complete && alreadyRestored ? stableFrames + 1 : 0;
    if (stableFrames >= 2) {
      stopRestore();
      return;
    }
    // Pause rather than abandon restoration when an async or virtualized view
    // has not reached its final scroll extent yet. Its next DOM mutation will
    // start another bounded attempt window.
    if (restoreAttempts >= RESTORE_FRAME_LIMIT) return;
    restoreFrame = requestAnimationFrame(restore);
  };

  const scheduleRestore = () => {
    if (!active || !restoring || restoreFrame !== undefined) return;
    restoreFrame = requestAnimationFrame(restore);
  };

  const observer = new MutationObserver(() => {
    restoreAttempts = 0;
    scheduleRestore();
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["style"],
    childList: true,
    subtree: true,
  });

  const handleScroll = (event: Event) => {
    if (!active || restoring || !(event.target instanceof HTMLElement)) return;
    if (!event.target.matches(SCROLLPORT_SELECTOR)) return;
    const position = snapshotForElement(root, event.target);
    if (position) scrollSnapshots.record(tabKey, position);
  };
  const handleUserIntent = () => stopRestore();

  root.addEventListener("scroll", handleScroll, true);
  root.addEventListener("wheel", handleUserIntent, {
    capture: true,
    passive: true,
  });
  root.addEventListener("touchstart", handleUserIntent, {
    capture: true,
    passive: true,
  });
  root.addEventListener("pointerdown", handleUserIntent, {
    capture: true,
    passive: true,
  });
  root.addEventListener("keydown", handleUserIntent, true);
  scheduleRestore();

  return {
    update(nextOptions) {
      if (nextOptions.active === active) return;
      active = nextOptions.active;
      if (!active) {
        stopRestore();
        return;
      }
      restoring = scrollSnapshots.positions(tabKey).length > 0;
      restoreAttempts = 0;
      stableFrames = 0;
      scheduleRestore();
    },
    destroy() {
      destroyed = true;
      stopRestore();
      observer.disconnect();
      root.removeEventListener("scroll", handleScroll, true);
      root.removeEventListener("wheel", handleUserIntent, true);
      root.removeEventListener("touchstart", handleUserIntent, true);
      root.removeEventListener("pointerdown", handleUserIntent, true);
      root.removeEventListener("keydown", handleUserIntent, true);
    },
  };
};

export function scheduleCenterTabScrollSnapshotPrune(
  openTabKeys: ReadonlySet<string>,
): void {
  if (pruneTimer !== undefined) clearTimeout(pruneTimer);
  const keys = new Set(openTabKeys);
  pruneTimer = setTimeout(() => {
    pruneTimer = undefined;
    scrollSnapshots.prune(keys);
  }, 0);
}
