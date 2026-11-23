// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import ContextMenuList from "./context-menu-list.svelte";

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

describe("ContextMenuList opened from a rect", () => {
  it("opens without a trigger, marks toggles, and reports the chosen item", async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(ContextMenuList, {
      props: {
        open: true,
        anchor: { getBoundingClientRect: () => new DOMRect(10, 20, 30, 10) },
        onOpenChange,
        items: [
          { label: "Wrap lines", checked: true, onSelect },
          { label: "Minimap", checked: false },
          { type: "separator" },
          { label: "Close", onSelect },
        ],
      },
    });
    const wrap = await screen.findByRole("menuitemcheckbox", {
      name: "Wrap lines",
    });
    expect(wrap.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Minimap" })
        .getAttribute("aria-checked"),
    ).toBe("false");

    await userEvent.click(screen.getByRole("menuitem", { name: "Close" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
