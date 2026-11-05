// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import Star from "@lucide/svelte/icons/star";
import { describe, expect, it, vi } from "vitest";
import IconAction from "./icon-action.svelte";

describe("IconAction", () => {
  it("is labelled by its label and fires onclick", async () => {
    const onclick = vi.fn();
    render(IconAction, { icon: Star, label: "Favourite", onclick });
    await userEvent.click(screen.getByRole("button", { name: "Favourite" }));
    expect(onclick).toHaveBeenCalledOnce();
  });

  it("blocks activation and swaps the icon while busy", async () => {
    const onclick = vi.fn();
    render(IconAction, { icon: Star, label: "Favourite", busy: true, onclick });
    const button = screen.getByRole("button", {
      name: "Favourite",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector("svg.lucide-star")).toBeNull();
    await userEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();
  });

  it("does not fire onclick when disabled", async () => {
    const onclick = vi.fn();
    render(IconAction, {
      icon: Star,
      label: "Favourite",
      disabled: true,
      onclick,
    });
    await userEvent.click(screen.getByRole("button", { name: "Favourite" }));
    expect(onclick).not.toHaveBeenCalled();
  });
});
