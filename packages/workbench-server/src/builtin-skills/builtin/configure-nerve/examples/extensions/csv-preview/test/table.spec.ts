import {
  afterEach,
  createFakeBridge,
  describe,
  expect,
  it,
} from "@nervekit/extension-sdk/testing";
import { host } from "@nervekit/extension-sdk/ui";
import { parseCsv } from "../src/ui/csv";

// The fake bridge answers like Nerve: the component's `host` reads the file you give it.
describe("table preview", () => {
  let bridge: ReturnType<typeof createFakeBridge> | undefined;
  afterEach(() => bridge?.close());

  it("reads the previewed file through the bridge", async () => {
    bridge = createFakeBridge({
      file: { path: "data/people.csv", content: "name,age\nAda,36\n" },
    });
    await host.ready;
    const info = await host.file.info();
    expect(info.extension).toBe(".csv");
    expect(parseCsv(await host.file.text())).toEqual([
      ["name", "age"],
      ["Ada", "36"],
    ]);
  });
});
