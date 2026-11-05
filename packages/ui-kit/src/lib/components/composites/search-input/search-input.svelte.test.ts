// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SearchInput from "./search-input.svelte";

describe("SearchInput", () => {
  it("reports typed values and clears through the clear button", async () => {
    const onValueChange = vi.fn();
    render(SearchInput, { onValueChange, ariaLabel: "Filter" });
    const input = screen.getByRole("textbox", { name: "Filter" });
    expect(screen.queryByRole("button")).toBeNull();

    await userEvent.type(input, "ab");
    expect(onValueChange).toHaveBeenLastCalledWith("ab");

    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onValueChange).toHaveBeenLastCalledWith("");
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides the clear button when not clearable", () => {
    render(SearchInput, { value: "abc", clearable: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("maps invalid and list-association props to ARIA attributes", () => {
    render(SearchInput, {
      invalid: true,
      controls: "list",
      activeDescendant: "row-1",
      describedBy: "err",
    });
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe("list");
    expect(input.getAttribute("aria-activedescendant")).toBe("row-1");
    expect(input.getAttribute("aria-describedby")).toBe("err");
  });

  it("omits aria-invalid when valid and forwards keydown", async () => {
    const onkeydown = vi.fn();
    render(SearchInput, { onkeydown });
    const input = screen.getByRole("textbox");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    await userEvent.type(input, "{ArrowDown}");
    expect(onkeydown).toHaveBeenCalledOnce();
  });
});
