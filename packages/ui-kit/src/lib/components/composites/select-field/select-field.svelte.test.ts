// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import SelectField from "./select-field.svelte";

beforeAll(() => {
  // jsdom lacks the pointer-capture, scroll and ResizeObserver APIs bits-ui calls.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  cleanup();
  // bits-ui restores the body scroll lock on a 24 ms timer after unmount; wait for it
  // so the timer cannot fire after the jsdom environment is torn down.
  await vi.waitFor(() =>
    expect(document.body.style.overflow).not.toBe("hidden"),
  );
});

const items = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma", disabled: true },
];

describe("SelectField", () => {
  it("shows the placeholder until a value matches an item's label", () => {
    render(SelectField, { items, ariaLabel: "Letter", placeholder: "Pick" });
    expect(
      screen.getByRole("button", { name: "Letter" }).textContent,
    ).toContain("Pick");
    cleanup();
    render(SelectField, { items, ariaLabel: "Letter", value: "b" });
    expect(
      screen.getByRole("button", { name: "Letter" }).textContent,
    ).toContain("Beta");
  });

  it("selecting an option reports its value and updates the trigger", async () => {
    const onValueChange = vi.fn();
    render(SelectField, { items, ariaLabel: "Letter", onValueChange });
    const trigger = screen.getByRole("button", { name: "Letter" });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByText("Beta"));
    expect(onValueChange).toHaveBeenCalledWith("b");
    expect(trigger.textContent).toContain("Beta");
  });
});
