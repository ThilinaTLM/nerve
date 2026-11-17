export * from "@nervekit/extension-api/testing";
// The test runner `nerve-ext test` uses, re-exported so an extension project needs no
// dependency of its own on it.
export { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
