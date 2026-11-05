// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { createRawSnippet } from "svelte";
import { describe, expect, it, vi } from "vitest";
import FormDialog from "./form-dialog.svelte";

const children = createRawSnippet(() => ({
  render: () => `<input aria-label="Name" />`,
}));

function setup(props: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const onOpenChange = vi.fn();
  render(FormDialog, {
    open: true,
    title: "Rename",
    submitLabel: "Save",
    onSubmit,
    onOpenChange,
    children,
    ...props,
  });
  return { onSubmit, onCancel, onOpenChange };
}

describe("FormDialog", () => {
  it("submits from the footer button and with Enter in a field", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByLabelText("Name"), "x{Enter}");
    expect(h.onSubmit).toHaveBeenCalledTimes(2);
  });

  it("busy disables both buttons and blocks submission", async () => {
    const h = setup({ busy: true });
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await userEvent.type(screen.getByLabelText("Name"), "x{Enter}");
    expect(h.onSubmit).not.toHaveBeenCalled();
  });

  it("submitDisabled gates submission but leaves Cancel usable", async () => {
    const h = setup({ submitDisabled: true });
    expect(
      (screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    await userEvent.type(screen.getByLabelText("Name"), "x{Enter}");
    expect(h.onSubmit).not.toHaveBeenCalled();
  });

  it("Cancel closes by default and defers to onCancel when provided", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onOpenChange).toHaveBeenLastCalledWith(false);
    cleanup();
    const custom = setup({ onCancel: vi.fn() });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(custom.onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the error message", () => {
    setup({ error: "Name is taken" });
    expect(screen.getByText("Name is taken")).toBeTruthy();
  });
});
