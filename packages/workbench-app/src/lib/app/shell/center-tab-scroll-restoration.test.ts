import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  CenterTabScrollSnapshotStore,
  retainCenterTabScroll,
  type ScrollPosition,
} from "./center-tab-scroll-restoration.js";

function position(
  path: readonly number[],
  top: number,
  left: number,
  signature = "slot:scroll-area-viewport",
  ordinal = 0,
): ScrollPosition {
  return { path, signature, ordinal, top, left };
}

test("keeps vertical and horizontal positions isolated by center tab", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record("file:a", position([0, 1], 480, 72));
  store.record("diff:b", position([0, 1], 920, 144));

  assert.deepEqual(store.positions("file:a"), [position([0, 1], 480, 72)]);
  assert.deepEqual(store.positions("diff:b"), [position([0, 1], 920, 144)]);
});

test("retains multiple independently located scrollports in one pane", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record(
    "pr:42",
    position([1, 0], 300, 0, "slot:scroll-area-viewport", 0),
  );
  store.record("pr:42", position([1, 2], 640, 18, "codemirror", 0));

  assert.deepEqual(store.positions("pr:42"), [
    position([1, 0], 300, 0, "slot:scroll-area-viewport", 0),
    position([1, 2], 640, 18, "codemirror", 0),
  ]);
});

test("updates a scrollport snapshot without duplicating its stable path", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record(
    "logs:application",
    position([0, 0], 120, 0, "virtual:Application logs"),
  );
  store.record(
    "logs:application",
    position([0, 0], 360, 0, "virtual:Application logs"),
  );

  assert.deepEqual(store.positions("logs:application"), [
    position([0, 0], 360, 0, "virtual:Application logs"),
  ]);
});

test("prunes closed tabs without affecting open tab snapshots", () => {
  const store = new CenterTabScrollSnapshotStore();
  store.record("file:open", position([0], 40, 0));
  store.record("file:closed", position([0], 80, 0));

  store.prune(new Set(["file:open"]));

  assert.equal(store.positions("file:closed").length, 0);
  assert.deepEqual(store.positions("file:open"), [position([0], 40, 0)]);
});

// Only the DOM surface used by the action; no browser layout is simulated.
class ScrollElement {
  readonly dataset: Record<string, string> = {};
  readonly classes = new Set<string>();
  readonly classList = { contains: (name: string) => this.classes.has(name) };
  readonly children = Object.assign([] as ScrollElement[], {
    item: (index: number) => this.children[index] ?? null,
  });
  readonly tagName = "DIV";
  parentElement: ScrollElement | null = null;
  readonly writes: Array<["top" | "left", number]> = [];
  private top = 0;
  private left = 0;
  private readonly listeners = new Map<string, EventListener>();

  get scrollTop() {
    return this.top;
  }
  set scrollTop(value: number) {
    this.writes.push(["top", value]);
    this.top = value;
  }
  get scrollLeft() {
    return this.left;
  }
  set scrollLeft(value: number) {
    this.writes.push(["left", value]);
    this.left = value;
  }

  // View-owner writes are not counted as generic restorer writes.
  move(top: number, left: number) {
    this.top = top;
    this.left = left;
  }
  append(...children: ScrollElement[]) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  getAttribute(name: string): string | null {
    if (!name.startsWith("data-")) return null;
    const key = name
      .slice(5)
      .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return this.dataset[key] ?? null;
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const value = part.trim();
      if (value.startsWith(".")) return this.classes.has(value.slice(1));
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(value);
      return (
        !!attribute &&
        this.getAttribute(attribute[1]) !== null &&
        (attribute[2] === undefined ||
          this.getAttribute(attribute[1]) === attribute[2])
      );
    });
  }
  querySelectorAll(selector: string): ScrollElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }
  removeEventListener(type: string) {
    this.listeners.delete(type);
  }
  scroll(target: ScrollElement) {
    this.listeners.get("scroll")?.({ target } as unknown as Event);
  }
}

function viewport(kind: "virtual" | "area" = "virtual"): ScrollElement {
  const element = new ScrollElement();
  if (kind === "virtual") element.classes.add("virtual-scroller-viewport");
  else element.dataset.slot = "scroll-area-viewport";
  return element;
}

let actionTabId = 0;
function actionHarness(t: TestContext, root: ScrollElement) {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let mutation: (() => void) | undefined;
  const globals = {
    HTMLElement: ScrollElement,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        mutation = callback;
      }
      observe() {}
      disconnect() {
        mutation = undefined;
      }
    },
  };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  const tabKey = `scroll-action-test:${++actionTabId}`;
  const action = retainCenterTabScroll(root as unknown as HTMLElement, {
    tabKey,
    active: true,
  });
  t.after(() => {
    try {
      action?.destroy?.();
    } finally {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  return {
    active(active: boolean) {
      action?.update?.({ tabKey, active });
    },
    mutate() {
      mutation?.();
    },
    flush() {
      let count = 0;
      while (frames.size) {
        assert.ok(++count <= 100, "restoration frames should be bounded");
        const pending = [...frames];
        frames.clear();
        for (const [, callback] of pending) callback(count);
      }
    },
  };
}

test("self-managed direct viewport is neither captured nor written after reactivation and mutations", (t) => {
  const root = new ScrollElement();
  const wrapper = new ScrollElement();
  wrapper.dataset.centerScrollRestoration = "self";
  const transcript = viewport();
  root.append(wrapper);
  wrapper.append(transcript);
  const harness = actionHarness(t, root);
  transcript.move(400, 20);
  root.scroll(transcript);
  harness.active(false);
  transcript.move(900, 35);
  harness.active(true);
  harness.flush();
  for (const bottom of [1000, 1100, 1200]) {
    transcript.move(bottom, 40);
    harness.mutate();
    harness.flush();
  }
  assert.deepEqual(transcript.writes, []);
  assert.equal(transcript.scrollTop, 1200);
  assert.equal(transcript.scrollLeft, 40);

  // Removing ownership makes a mistakenly captured snapshot observable.
  harness.active(false);
  delete wrapper.dataset.centerScrollRestoration;
  harness.active(true);
  harness.flush();
  assert.deepEqual(
    transcript.writes,
    [],
    "excluded scroll events must not save a snapshot",
  );
});

test("previously saved exact path cannot restore a now self-managed viewport", (t) => {
  const root = new ScrollElement();
  const wrapper = new ScrollElement();
  const transcript = viewport();
  root.append(wrapper);
  wrapper.append(transcript);
  const harness = actionHarness(t, root);
  transcript.move(300, 24);
  root.scroll(transcript);
  harness.active(false);
  wrapper.dataset.centerScrollRestoration = "self";
  transcript.move(900, 50);
  harness.active(true);
  harness.flush();
  transcript.move(1000, 60);
  harness.mutate();
  harness.flush();
  assert.deepEqual(transcript.writes, []);
  assert.equal(transcript.scrollTop, 1000);
  assert.equal(transcript.scrollLeft, 60);
});

test("fallback skips self-managed viewport sharing the saved signature", (t) => {
  const root = new ScrollElement();
  const original = viewport();
  root.append(original);
  const harness = actionHarness(t, root);
  original.move(320, 28);
  root.scroll(original);
  harness.active(false);
  const wrapper = new ScrollElement();
  wrapper.dataset.centerScrollRestoration = "self";
  const excluded = viewport();
  const eligible = viewport();
  excluded.move(950, 50);
  wrapper.append(excluded);
  root.children.splice(0);
  root.append(wrapper, eligible);
  harness.active(true);
  harness.flush();
  assert.deepEqual(excluded.writes, []);
  assert.equal(eligible.scrollTop, 320);
  assert.equal(eligible.scrollLeft, 28);
});

test("nested output beneath self-managed transcript captures and restores both axes", (t) => {
  const root = new ScrollElement();
  const wrapper = new ScrollElement();
  wrapper.dataset.centerScrollRestoration = "self";
  const transcript = viewport();
  const row = new ScrollElement();
  // Same signature as the excluded viewport also exercises eligible ordinals.
  const output = viewport();
  root.append(wrapper);
  wrapper.append(transcript);
  transcript.append(row);
  row.append(output);
  const harness = actionHarness(t, root);
  output.move(480, 72);
  root.scroll(output);
  harness.active(false);
  transcript.move(1100, 30);
  output.move(0, 0);
  // Move the saved path so fallback must use the eligible-only ordinal.
  const spacer = new ScrollElement();
  spacer.parentElement = row;
  row.children.unshift(spacer);
  harness.active(true);
  harness.flush();
  assert.equal(output.scrollTop, 480);
  assert.equal(output.scrollLeft, 72);
  harness.mutate();
  harness.flush();
  assert.deepEqual(transcript.writes, []);
});

for (const kind of ["virtual", "area"] as const) {
  test(`ordinary ${kind} viewport restores both axes across tab switches`, (t) => {
    const root = new ScrollElement();
    const ordinary = viewport(kind);
    root.append(ordinary);
    const harness = actionHarness(t, root);
    ordinary.move(640, 96);
    root.scroll(ordinary);
    harness.active(false);
    ordinary.move(0, 0);
    harness.active(true);
    harness.flush();
    assert.equal(ordinary.scrollTop, 640);
    assert.equal(ordinary.scrollLeft, 96);
  });
}
