import {
  afterEach,
  createFakeBridge,
  describe,
  expect,
  it,
  mount,
  unmount,
  vi,
} from "@nervekit/extension-sdk/testing";
import Checklist from "./Checklist.svelte";

describe("Checklist panel", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("restores its items from the view state", async () => {
    const bridge = createFakeBridge({
      kind: "panel",
      viewState: { items: [{ id: "1", text: "Write tests", done: false }] },
    });
    const component = mount(Checklist, { target: document.body });
    cleanup = () => {
      void unmount(component);
      bridge.close();
    };
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Write tests"),
    );
  });

  it("deletes an item from its right-click menu", async () => {
    const bridge = createFakeBridge({
      kind: "panel",
      viewState: { items: [{ id: "1", text: "Write tests", done: false }] },
      menu: (items) =>
        items.find((item) => item.label === "Delete")?.id ?? null,
    });
    const component = mount(Checklist, { target: document.body });
    cleanup = () => {
      void unmount(component);
      bridge.close();
    };
    const row = await vi.waitFor(() => {
      const found = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Write tests"),
      );
      if (!found) throw new Error("row not rendered");
      return found;
    });
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 5,
        clientY: 5,
      }),
    );
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("No items yet"),
    );
  });
});
