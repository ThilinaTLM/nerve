// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";
import FloatingPanel from "./floating-panel.svelte";
import FloatingToolbar from "./floating-toolbar.svelte";
import FloatingToolbarButton from "./floating-toolbar-button.svelte";

const buttons = createRawSnippet(() => ({
  render: () =>
    `<div><button>One</button><button disabled>Off</button><button>Two</button><button>Three</button></div>`,
}));

describe("FloatingToolbar", () => {
  it("moves focus between enabled controls with arrow keys, Home and End", async () => {
    render(FloatingToolbar, { label: "Controls", children: buttons });
    const [one, , two, three] = screen.getAllByRole("button");
    one!.focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(two);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(three);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(one);
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(three);
  });

  it("uses up and down in a vertical bar", async () => {
    render(FloatingToolbar, {
      label: "Zoom",
      orientation: "vertical",
      children: buttons,
    });
    const [one, , two] = screen.getAllByRole("button");
    one!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(one);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(two);
  });
});

describe("FloatingToolbarButton", () => {
  it("is named by its label, reports a toggle state and fires onclick", async () => {
    const onclick = vi.fn();
    render(FloatingToolbarButton, {
      label: "Wrap lines",
      pressed: true,
      onclick,
    });
    const button = screen.getByRole("button", { name: "Wrap lines" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(button);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it("names a text button by its text and its label", () => {
    render(FloatingToolbarButton, { label: "Actual size", text: "232%" });
    expect(
      screen.getByRole("button", { name: "232%, Actual size" }),
    ).toBeTruthy();
  });

  it("blocks activation while busy", async () => {
    const onclick = vi.fn();
    render(FloatingToolbarButton, { label: "Save", busy: true, onclick });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onclick).not.toHaveBeenCalled();
  });
});

describe("FloatingPanel", () => {
  it("closes on Escape from inside", async () => {
    const onClose = vi.fn();
    const field = createRawSnippet(() => ({
      render: () => `<input aria-label="Find" />`,
    }));
    render(FloatingPanel, { label: "Find", onClose, children: field });
    screen.getByRole("textbox", { name: "Find" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
