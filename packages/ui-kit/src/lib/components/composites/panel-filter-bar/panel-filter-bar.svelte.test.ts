// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PanelFilterBar from "./panel-filter-bar.svelte";

const scopes = [
  { value: "all", label: "All", count: 3 },
  { value: "failed", label: "Failed", count: 1 },
];

describe("PanelFilterBar", () => {
  it("shows the search field from a placeholder alone", () => {
    render(PanelFilterBar, {
      placeholder: "Filter",
      ariaLabel: "Filter items",
    });
    expect(screen.getByRole("textbox", { name: "Filter items" })).toBeTruthy();
  });

  it("renders chips only without a placeholder and reports the picked scope", async () => {
    const onScopeChange = vi.fn();
    render(PanelFilterBar, { scopes, scope: "all", onScopeChange });
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: /Failed/ }));
    expect(onScopeChange).toHaveBeenCalledWith("failed");
  });
});
