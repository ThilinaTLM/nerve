// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SwitchField from "./switch-field.svelte";

afterEach(cleanup);

describe("SwitchField", () => {
  it("toggles by click and by keyboard, reporting the next value", async () => {
    const onCheckedChange = vi.fn();
    render(SwitchField, { label: "Notify", onCheckedChange });
    const toggle = screen.getByRole("switch", { name: "Notify" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    await userEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    toggle.focus();
    await userEvent.keyboard(" ");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("does not toggle when disabled", async () => {
    const onCheckedChange = vi.fn();
    render(SwitchField, { label: "Notify", disabled: true, onCheckedChange });
    await userEvent.click(screen.getByRole("switch", { name: "Notify" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
