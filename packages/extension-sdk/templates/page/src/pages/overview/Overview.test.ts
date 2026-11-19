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
import Overview from "./Overview.svelte";

describe("Overview page", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("shows the project and opens the chosen file", async () => {
    const bridge = createFakeBridge({
      kind: "page",
      project: { name: "demo" },
    });
    const component = mount(Overview, { target: document.body });
    cleanup = () => {
      void unmount(component);
      bridge.close();
    };
    await vi.waitFor(() => expect(document.body.textContent).toContain("demo"));
    const open = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Open file",
    );
    open?.click();
    await vi.waitFor(() => expect(bridge.opened.files).toEqual(["README.md"]));
  });
});
