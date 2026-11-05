import { cleanup } from "@testing-library/svelte";
import { afterEach, expect, vi } from "vitest";

// Unmount after every test, then wait for bits-ui to restore the body scroll lock.
// It does so on a 24 ms timer after the last overlay unmounts; if that timer fires
// after the file's jsdom environment is torn down, it throws "document is not defined".
afterEach(async () => {
  cleanup();
  await vi.waitFor(() =>
    expect(document.body.style.overflow).not.toBe("hidden"),
  );
});
