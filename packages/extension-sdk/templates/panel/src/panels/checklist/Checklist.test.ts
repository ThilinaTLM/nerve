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
      viewState: { items: [{ text: "Write tests", done: false }] },
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
});
