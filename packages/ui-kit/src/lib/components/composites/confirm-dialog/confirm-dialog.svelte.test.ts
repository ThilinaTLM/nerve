// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./confirm-dialog.svelte";

function setup(props: Record<string, unknown> = {}) {
  const handlers = {
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onSecondary: vi.fn(),
    onOpenChange: vi.fn(),
  };
  render(ConfirmDialog, {
    open: true,
    title: "Delete thing",
    description: "This cannot be undone.",
    confirmLabel: "Delete",
    ...handlers,
    ...props,
  });
  return handlers;
}

describe("ConfirmDialog", () => {
  it("confirm runs onConfirm then closes", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(h.onConfirm).toHaveBeenCalledTimes(1);
    expect(h.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("cancel runs onCancel then closes without confirming", async () => {
    const h = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it("renders the secondary action only when labelled, and it closes too", async () => {
    setup();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    cleanup();
    const h = setup({ secondaryLabel: "Skip" });
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(h.onSecondary).toHaveBeenCalledTimes(1);
    expect(h.onConfirm).not.toHaveBeenCalled();
    expect(h.onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("Escape dismisses through onOpenChange without confirming", async () => {
    const h = setup();
    await userEvent.keyboard("{Escape}");
    expect(h.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(h.onConfirm).not.toHaveBeenCalled();
  });
});
