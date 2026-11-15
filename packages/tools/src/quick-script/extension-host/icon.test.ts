import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveExtensionIcon, svgProblem } from "./icon.js";

const atlassian = readFileSync(
  new URL("../../../../extensions/src/atlassian/icon.svg", import.meta.url),
  "utf8",
);
const svg = (attrs: string, body = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

void test("the Atlassian mark is accepted and becomes a data URI", () => {
  assert.equal(svgProblem(atlassian), undefined);
  const icon = resolveExtensionIcon(
    { id: "atlassian", icon: "icon.svg" },
    () => atlassian,
  );
  assert.equal(icon.type, "svg");
  assert.ok(
    icon.type === "svg" &&
      decodeURIComponent(icon.src.slice("data:image/svg+xml,".length)) ===
        atlassian,
  );
});

void test("unsafe or malformed SVGs are rejected", () => {
  const box = 'viewBox="0 0 32 32"';
  assert.match(svgProblem(svg(box, "x".repeat(17 * 1024)))!, /larger/);
  assert.match(svgProblem(svg('viewBox="0 0 32 24"'))!, /square/);
  assert.match(svgProblem(svg("width='8'"))!, /square/);
  assert.match(svgProblem(svg(box, "<script>1</script>"))!, /script/);
  assert.match(svgProblem(svg(box, '<path onclick="x()"/>'))!, /event/);
  assert.match(
    svgProblem(svg(box, '<use href="https://example.com/a.svg#b"/>'))!,
    /outside/,
  );
  assert.match(
    svgProblem(svg(box, '<path fill="url(https://example.com/g)"/>'))!,
    /outside/,
  );
  assert.equal(
    svgProblem(svg(box, '<path fill="url(#g)"/><use xlink:href="#g"/>')),
    undefined,
  );
});

void test("lucide names are checked, with the extension id in the error", () => {
  assert.deepEqual(resolveExtensionIcon({ id: "web", icon: "globe" }), {
    type: "lucide",
    name: "globe",
  });
  assert.throws(
    () => resolveExtensionIcon({ id: "acme", icon: "box" }),
    /acme: unknown icon 'box'/,
  );
});
