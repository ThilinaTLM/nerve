// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./confirm-dialog.svelte";
import Harness from "./confirm-dialog-test-harness.svelte";

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

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

  it("reopens for an unbound caller after confirm, cancel and Escape", async () => {
    const onDone = vi.fn();
    render(Harness, { onDone });
    await userEvent.click(screen.getByText("delete-a"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete" }),
    );
    await settle();
    await userEvent.click(screen.getByText("delete-b"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );
    await settle();
    await userEvent.click(screen.getByText("delete-b"));
    await screen.findByRole("alertdialog");
    await userEvent.keyboard("{Escape}");
    await settle();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await userEvent.click(screen.getByText("delete-c"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete" }),
    );
    expect(onDone.mock.calls.map(([id]) => id)).toEqual(["a", "c"]);
  });

  it("closes and reopens a bound caller", async () => {
    const onDone = vi.fn();
    render(Harness, { bound: true, onDone });
    for (let round = 0; round < 2; round++) {
      await userEvent.click(screen.getByText("open-bound"));
      await userEvent.click(
        await screen.findByRole("button", { name: "Delete" }),
      );
      await settle();
      expect(screen.getByTestId("bound-state").textContent).toBe("false");
      expect(screen.queryByRole("alertdialog")).toBeNull();
    }
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
