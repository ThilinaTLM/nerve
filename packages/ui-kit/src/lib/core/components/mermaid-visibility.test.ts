import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MERMAID_PRELOAD_MARGIN,
  observeMermaidVisibility,
} from "./mermaid-visibility";

type FakeObserver = {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  observed: Element[];
  unobserved: Element[];
  disconnectCount: number;
};

function host(): Element {
  return {} as Element;
}

function setupObserver() {
  const state: FakeObserver = {
    callback: () => undefined,
    options: {},
    observed: [],
    unobserved: [],
    disconnectCount: 0,
  };
  const createObserver = (
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) => {
    state.callback = callback;
    state.options = options;
    return {
      observe: (target: Element) => state.observed.push(target),
      unobserve: (target: Element) => state.unobserved.push(target),
      disconnect: () => {
        state.disconnectCount += 1;
      },
    };
  };
  return { state, createObserver };
}

function entry(
  target: Element,
  isIntersecting: boolean,
): IntersectionObserverEntry {
  return { target, isIntersecting } as IntersectionObserverEntry;
}

describe("Mermaid visibility observer", () => {
  it("observes every host with the configured root and preload margin", () => {
    const first = host();
    const second = host();
    const root = host();
    const { state, createObserver } = setupObserver();

    observeMermaidVisibility([first, second], {
      root,
      mount: () => undefined,
      createObserver,
    });

    assert.deepEqual(state.observed, [first, second]);
    assert.equal(state.options.root, root);
    assert.equal(state.options.rootMargin, MERMAID_PRELOAD_MARGIN);
    assert.equal(state.options.threshold, 0);
  });

  it("mounts intersecting hosts once and unobserves them", () => {
    const first = host();
    const second = host();
    const mounted: Element[] = [];
    const { state, createObserver } = setupObserver();

    observeMermaidVisibility([first, second], {
      root: null,
      mount: (target) => mounted.push(target),
      createObserver,
    });

    state.callback(
      [entry(first, false), entry(second, true)],
      {} as IntersectionObserver,
    );
    state.callback([entry(second, true)], {} as IntersectionObserver);

    assert.deepEqual(mounted, [second]);
    assert.deepEqual(state.unobserved, [second]);
  });

  it("disconnects and suppresses callbacks after cleanup", () => {
    const target = host();
    const mounted: Element[] = [];
    const { state, createObserver } = setupObserver();
    const cleanup = observeMermaidVisibility([target], {
      root: null,
      mount: (next) => mounted.push(next),
      createObserver,
    });

    cleanup();
    state.callback([entry(target, true)], {} as IntersectionObserver);

    assert.equal(state.disconnectCount, 1);
    assert.deepEqual(mounted, []);
  });

  it("mounts eagerly when IntersectionObserver is unavailable", () => {
    const original = globalThis.IntersectionObserver;
    const first = host();
    const second = host();
    const mounted: Element[] = [];
    try {
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        value: undefined,
      });
      observeMermaidVisibility([first, second], {
        root: null,
        mount: (target) => mounted.push(target),
      });
    } finally {
      Object.defineProperty(globalThis, "IntersectionObserver", {
        configurable: true,
        value: original,
      });
    }

    assert.deepEqual(mounted, [first, second]);
  });
});
