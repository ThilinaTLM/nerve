export * from "@nervekit/extension-api/testing";
// The test runner `nerve-ext test` uses, re-exported so an extension project needs no
// dependency of its own on it.
export { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
// A fake host for UI tests: `createFakeBridge()` answers the frame's `host` like Nerve does.
export {
  createFakeBridge,
  type FakeBridge,
  type FakeBridgeOptions,
} from "./ui/testing.js";
