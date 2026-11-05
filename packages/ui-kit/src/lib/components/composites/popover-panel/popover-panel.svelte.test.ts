// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import { beforeAll, describe, expect, it, vi } from "vitest";
import PopoverPanel from "./popover-panel.svelte";

beforeAll(() => {
  // jsdom lacks ResizeObserver, which floating-ui positioning needs.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const trigger = createRawSnippet(() => ({ render: () => `<span>Menu</span>` }));
const children = createRawSnippet(() => ({
  render: () => `<button>Inside</button>`,
}));

describe("PopoverPanel", () => {
  it("opens from the trigger and closes on Escape, restoring trigger focus", async () => {
    const onOpenChange = vi.fn();
    render(PopoverPanel, {
      trigger,
      children,
      ariaLabel: "Menu",
      onOpenChange,
    });
    const button = screen.getByRole("button", { name: "Menu" });
    expect(screen.queryByText("Inside")).toBeNull();

    await userEvent.click(button);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(await screen.findByText("Inside")).toBeTruthy();

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(button);
  });
});
