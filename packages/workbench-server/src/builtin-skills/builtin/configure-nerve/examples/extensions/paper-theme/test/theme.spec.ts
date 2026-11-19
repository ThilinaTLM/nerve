import { describe, expect, it } from "@nervekit/extension-sdk/testing";
import theme from "../themes/paper-theme.json";

describe("theme paper-theme", () => {
  it("sets all 17 tokens", () => {
    expect(Object.keys(theme.tokens)).toHaveLength(17);
  });
});
