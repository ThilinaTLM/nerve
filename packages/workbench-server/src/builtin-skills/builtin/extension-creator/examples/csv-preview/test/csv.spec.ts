import { describe, expect, it } from "@nervekit/extension-sdk/testing";
import { parseCsv } from "../src/ui/csv";

describe("parseCsv", () => {
  it("splits rows and cells", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps delimiters and quotes inside quoted cells", () => {
    expect(parseCsv('x,"a,""b"""\n')).toEqual([["x", 'a,"b"']]);
  });
});
