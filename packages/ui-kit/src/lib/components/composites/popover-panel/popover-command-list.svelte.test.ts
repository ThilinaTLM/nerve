// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import PopoverCommandList from "./popover-command-list.svelte";

beforeAll(() => {
  // jsdom lacks ResizeObserver (scroll region) and scrollIntoView (navigation).
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

const items = [
  { key: "a", label: "Alpha", group: "Letters" },
  { key: "b", label: "Beta", group: "Letters" },
  { key: "1", label: "One", group: "Numbers", keywords: ["first"] },
];

function setup(props: Record<string, unknown> = {}) {
  const onChoose = vi.fn();
  render(PopoverCommandList, {
    items,
    ariaLabel: "Pick",
    onChoose,
    autofocus: false,
    ...props,
  });
  return { onChoose, search: screen.getByRole("textbox", { name: "Pick" }) };
}

describe("PopoverCommandList", () => {
  it("navigates with arrows, exposes the active row, and chooses on Enter", async () => {
    const { onChoose, search } = setup();
    await userEvent.click(search);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    const beta = screen.getByRole("option", { name: "Beta" });
    expect(search.getAttribute("aria-activedescendant")).toBe(beta.id);

    await userEvent.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(items[1]);
  });

  it("chooses the first match on Enter when nothing is highlighted", async () => {
    const { onChoose, search } = setup();
    await userEvent.type(search, "first{Enter}");
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(items[2]);
  });

  it("filters by query, resets the highlight, and shows the empty message", async () => {
    const { search } = setup({ empty: "Nothing here" });
    await userEvent.click(search);
    await userEvent.keyboard("{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).not.toBeNull();

    await userEvent.type(search, "bet");
    expect(search.getAttribute("aria-activedescendant")).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(1);

    await userEvent.type(search, "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });

  it("skips disabled rows for keyboard choice and click", async () => {
    const { onChoose, search } = setup({
      isDisabled: (item: { key: string }) => item.key === "a",
    });
    await userEvent.click(screen.getByRole("option", { name: "Alpha" }));
    expect(onChoose).not.toHaveBeenCalled();

    await userEvent.click(search);
    await userEvent.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(items[1]);
  });

  it("marks selected rows", () => {
    setup({ isSelected: (item: { key: string }) => item.key === "b" });
    expect(
      screen
        .getByRole("option", { name: "Beta" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("option", { name: "Alpha" })
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
});
