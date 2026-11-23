export * from "@nervekit/extension-api/testing";
// The test runner `nerve-ext test` uses, re-exported so an extension project needs no
// dependency of its own on it.
export { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
// Svelte's mounting functions for component tests, from the same Svelte the components compile against.
export { flushSync, mount, tick, unmount } from "svelte";
// A fake host for UI tests: `createFakeBridge()` answers the frame's `host` like Nerve does.
export {
  createFakeBridge,
  type FakeBridge,
  type FakeBridgeOptions,
} from "./frame/testing.js";
