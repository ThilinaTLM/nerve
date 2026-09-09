import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

// Runes are compiler syntax, so the module under test needs the same `$state`
// shim the other `.svelte.ts` state tests use.
Object.assign(globalThis, {
  $state: <Value>(value?: Value) => value,
});

const { createListNavigation } = await import("./list-navigation.svelte.js");

type Item = { id: string };

const items: Item[] = [{ id: "a" }, { id: "b" }, { id: "c" }];

function key(name: string): KeyboardEvent {
  let defaultPrevented = false;
  return {
    key: name,
    preventDefault() {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  } as unknown as KeyboardEvent;
}

describe("popover list navigation", () => {
  let chosen: Item[] = [];
  let visible: Item[] = items;

  function setup() {
    chosen = [];
    visible = items;
    return createListNavigation<Item>({
      items: () => visible,
      getId: (item) => `row:${item.id}`,
      onChoose: (item) => chosen.push(item),
    });
  }

  beforeEach(() => {
    // Rows scroll themselves into view on the next frame; the tests only care
    // about index math, so a no-op frame keeps them free of DOM setup.
    globalThis.requestAnimationFrame = (() => 0) as never;
  });

  it("starts with no active row so the first Enter takes the top match", () => {
    const nav = setup();
    assert.equal(nav.index, -1);
    assert.equal(nav.activeDescendant, undefined);
    nav.chooseActive();
    assert.deepEqual(chosen, [items[0]]);
  });

  it("moves down from the top and up from the bottom", () => {
    const nav = setup();
    nav.handleKeydown(key("ArrowDown"));
    assert.equal(nav.index, 0);
    nav.handleKeydown(key("ArrowDown"));
    assert.equal(nav.activeDescendant, "row:b");

    nav.reset();
    nav.handleKeydown(key("ArrowUp"));
    assert.equal(nav.activeDescendant, "row:c");
  });

  it("clamps at both ends instead of wrapping", () => {
    const nav = setup();
    nav.handleKeydown(key("End"));
    nav.handleKeydown(key("ArrowDown"));
    assert.equal(nav.index, items.length - 1);

    nav.handleKeydown(key("Home"));
    nav.handleKeydown(key("ArrowUp"));
    assert.equal(nav.index, 0);
  });

  it("ignores navigation and choosing when the list is empty", () => {
    const nav = setup();
    visible = [];
    nav.handleKeydown(key("ArrowDown"));
    assert.equal(nav.index, -1);
    nav.chooseActive();
    assert.deepEqual(chosen, []);
  });

  it("reports the active row so selection and highlight stay separate", () => {
    const nav = setup();
    nav.handleKeydown(key("ArrowDown"));
    assert.equal(nav.isActive(0), true);
    assert.equal(nav.isActive(1), false);
  });

  it("consumes the keys it handles and leaves others alone", () => {
    const nav = setup();
    const handled = key("ArrowDown");
    nav.handleKeydown(handled);
    assert.equal(handled.defaultPrevented, true);

    const passed = key("a");
    nav.handleKeydown(passed);
    assert.equal(passed.defaultPrevented, false);
  });
});
