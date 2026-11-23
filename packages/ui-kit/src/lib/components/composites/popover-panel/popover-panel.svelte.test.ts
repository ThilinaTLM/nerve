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

  it("opens against an external anchor without rendering a trigger", async () => {
    const anchor = document.createElement("button");
    anchor.textContent = "Row";
    document.body.append(anchor);
    const onOpenChange = vi.fn();
    // `anchor` is also a Svelte mount option, so pass props explicitly.
    render(PopoverPanel, {
      props: {
        anchor,
        open: true,
        children,
        ariaLabel: "Rename",
        onOpenChange,
      },
    });
    expect(await screen.findByText("Inside")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();

    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  it("opens against a virtual anchor (a rect, not an element)", async () => {
    const onOpenChange = vi.fn();
    const rect = new DOMRect(40, 60, 100, 20);
    const anchor = { getBoundingClientRect: () => rect };
    render(PopoverPanel, {
      props: { anchor, open: true, children, ariaLabel: "Pick", onOpenChange },
    });
    expect(await screen.findByText("Inside")).toBeTruthy();

    // There is no element to hand focus back to; Escape still closes.
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
