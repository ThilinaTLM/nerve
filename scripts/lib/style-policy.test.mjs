import assert from "node:assert/strict";
import test from "node:test";
import {
  countClassConsumers,
  extractClassSelectors,
  findBareGlobalSelectors,
  isDynamicClass,
} from "./style-policy.mjs";

test("extractClassSelectors ignores comments and collects class names", () => {
  const css = `
    /* .commented-out {} */
    .alpha,
    .beta > .gamma:hover {
      color: red;
    }
  `;
  assert.deepEqual(extractClassSelectors(css), ["alpha", "beta", "gamma"]);
});

test("a class used by two components passes the consumer count", () => {
  const files = new Map([
    ["a.svelte", '<div class="shared-thing"></div>'],
    ["b.svelte", '<span class={cn("shared-thing", extra)}></span>'],
    ["c.svelte", "<p></p>"],
  ]);
  assert.equal(countClassConsumers("shared-thing", files), 2);
});

test("a single-consumer class is reported as such", () => {
  const files = new Map([
    ["a.svelte", '<div class="only-here"></div>'],
    ["b.svelte", '<div class="only-here-extended"></div>'],
  ]);
  assert.equal(countClassConsumers("only-here", files), 1);
});

test("a dead class has no consumers", () => {
  const files = new Map([["a.svelte", "<div></div>"]]);
  assert.equal(countClassConsumers("gone", files), 0);
});

test("allowlisted dynamic classes are exempt", () => {
  assert.equal(isDynamicClass("dialog-header"), true);
  assert.equal(isDynamicClass("ansi-red"), true);
  assert.equal(isDynamicClass("svelte-flow__node"), true);
  assert.equal(isDynamicClass("panel-row-hoverable"), true);
  assert.equal(isDynamicClass("footer-item"), false);
});

test("a bare :global class selector is reported", () => {
  const source = `<style>
:global(.log-list) {
  height: 100%;
}
</style>`;
  assert.deepEqual(findBareGlobalSelectors(source), [".log-list"]);
});

test("a :global selector scoped under a local class passes", () => {
  const source = `<style>
.wrap :global(.log-list) {
  height: 100%;
}

.wrap
  :global(.svelte-flow__edge.active .svelte-flow__edge-path) {
  stroke: red;
}
</style>`;
  assert.deepEqual(findBareGlobalSelectors(source), []);
});

test("allowlisted portal and theme roots pass", () => {
  const source = `<style>
:global(.dark) :global(span) {
  color: red;
}

:global(.dialog-content.project-picker-dialog) {
  width: 40rem;
}
</style>`;
  assert.deepEqual(findBareGlobalSelectors(source), []);
});

test("a bare :global inside a media query is still reported", () => {
  const source = `<style>
@media (max-width: 40rem) {
  :global(.leaky) {
    display: none;
  }
}
</style>`;
  assert.deepEqual(findBareGlobalSelectors(source), [".leaky"]);
});
