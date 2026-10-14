import { strict as assert } from "node:assert";
import { it } from "node:test";
import { htmlPreviewAvailability } from "./html-preview-source.js";
const file = {
  path: "/repo/mock.html",
  relativePath: "mock.html",
  name: "mock.html",
  size: 10,
  type: "text" as const,
};
it("allows complete project text but explicitly refuses truncated and outside-project files", () => {
  assert.equal(htmlPreviewAvailability(file), undefined);
  assert.match(
    htmlPreviewAvailability({ ...file, truncated: true })!,
    /truncated/,
  );
  for (const relativePath of [
    undefined,
    "/tmp/mock.html",
    "../mock.html",
    "C:\\mock.html",
    "..\\mock.html",
  ]) {
    assert.match(
      htmlPreviewAvailability({ ...file, relativePath })!,
      /inside the project/,
    );
  }
  assert.ok(htmlPreviewAvailability(undefined));
});
