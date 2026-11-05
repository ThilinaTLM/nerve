// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SelectRow from "./select-row.svelte";

describe("SelectRow", () => {
  it("exposes selection as aria-pressed for plain toggle rows", () => {
    render(SelectRow, { label: "Row", selected: true });
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("drops aria-pressed for option rows and navigation rows", () => {
    const { unmount } = render(SelectRow, {
      label: "Opt",
      role: "option",
      selected: true,
      "aria-selected": true,
    });
    const option = screen.getByRole("option");
    expect(option.hasAttribute("aria-pressed")).toBe(false);
    expect(option.getAttribute("aria-selected")).toBe("true");
    unmount();

    render(SelectRow, { label: "Nav", current: false });
    expect(screen.getByRole("button").hasAttribute("aria-pressed")).toBe(false);
  });

  it("maps current to aria-current", () => {
    const { unmount } = render(SelectRow, { label: "Page", current: "page" });
    expect(screen.getByRole("button").getAttribute("aria-current")).toBe(
      "page",
    );
    unmount();
    render(SelectRow, { label: "Here", current: true });
    expect(screen.getByRole("button").getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("does not fire onclick when disabled", async () => {
    const onclick = vi.fn();
    render(SelectRow, { label: "Row", disabled: true, onclick });
    await userEvent.click(screen.getByRole("button"));
    expect(onclick).not.toHaveBeenCalled();
  });
});
