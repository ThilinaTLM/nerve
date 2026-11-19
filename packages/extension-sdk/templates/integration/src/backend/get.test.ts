import {
  createFakeContext,
  describe,
  expect,
  it,
} from "@nervekit/extension-sdk/testing";
import items from "./fixtures/items.json";
import { get } from "./get";

describe("get", () => {
  it("reads JSON from the configured server", async () => {
    const { ctx, record } = createFakeContext({
      settings: { server: "https://api.test/" },
      http: () => ({
        status: 200,
        ok: true,
        headers: {},
        url: "",
        body: items,
      }),
    });
    expect(await get.run(undefined, get.parse(["/items"]), ctx)).toEqual(items);
    expect(record.requests[0]?.url).toBe("https://api.test/items");
  });

  it("accepts the arguments object of the direct tool", () => {
    expect(get.parse([{ path: "/items" }])).toEqual({ path: "/items" });
  });

  it("authorizes the path it reads", () => {
    expect(get.authorize?.({ path: "/items" })).toEqual([
      { targets: ["__ID__:path/items"], summary: "GET /items" },
    ]);
  });

  it("rejects a path without a leading slash", () => {
    expect(() => get.parse(["items"])).toThrow("starts with '/'");
  });
});
