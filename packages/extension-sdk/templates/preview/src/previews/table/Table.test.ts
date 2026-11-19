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
import Table from "./Table.svelte";

// The fake bridge answers like Nerve: the component's `host` reads the file given here.
describe("Table preview", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  function render(content: string) {
    const bridge = createFakeBridge({
      file: { path: "data/people.csv", content },
    });
    const component = mount(Table, { target: document.body });
    cleanup = () => {
      void unmount(component);
      bridge.close();
    };
  }

  it("renders the file as a table", async () => {
    render("name,age\nAda,36\n");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Ada"));
    expect(document.querySelectorAll("th")).toHaveLength(2);
    expect(document.body.textContent).toContain("1 rows");
  });

  it("says when the file is empty", async () => {
    render("");
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("The file is empty."),
    );
  });
});
