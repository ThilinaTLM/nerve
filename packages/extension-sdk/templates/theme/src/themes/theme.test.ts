import { describe, expect, it } from "@nervekit/extension-sdk/testing";
import theme from "./__ID__.json";

// nerve-ext build checks the readability rules (contrast, chroma, distinct syntax roles).
describe("theme __ID__", () => {
  it("sets all 17 tokens", () => {
    expect(Object.keys(theme.tokens)).toHaveLength(17);
  });
});
