import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* Every floating panel in the workbench is the same object: a PopoverPanel with
 * a header, an optional search row, one scrolling body, and an optional footer.
 * The panel owns its width, padding, and scroll bounds, so a consumer that
 * restates them is drifting back toward the per-popover chrome this replaced. */

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const PANEL_IMPORT = "components/composites/popover-panel";

function svelteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...svelteFiles(full));
    else if (entry.endsWith(".svelte")) out.push(full);
  }
  return out;
}

const components = svelteFiles(appRoot).map((file) => ({
  name: path.relative(appRoot, file),
  source: readFileSync(file, "utf8"),
}));

const panelComponents = components.filter((file) =>
  file.source.includes(PANEL_IMPORT),
);

describe("popover anatomy", () => {
  it("finds the popovers it is meant to guard", () => {
    assert.ok(
      panelComponents.length >= 12,
      `expected the workbench popovers to use ${PANEL_IMPORT}, found ${panelComponents.length}`,
    );
  });

  it("routes every popover through PopoverPanel", () => {
    for (const file of components) {
      assert.ok(
        !file.source.includes('from "@nervekit/ui-kit/components/ui/popover"'),
        `${file.name} uses the raw popover primitive; build the panel from ${PANEL_IMPORT} instead`,
      );
    }
  });

  it("gives every popover exactly one header", () => {
    for (const file of panelComponents) {
      const headers = file.source.match(/<PopoverHeader\b/g) ?? [];
      assert.equal(
        headers.length,
        1,
        `${file.name} declares ${headers.length} PopoverHeader elements; a panel is titled once`,
      );
    }
  });

  it("leaves panel width, padding, and scrolling to the panel", () => {
    const frameOverride =
      /<(?:Popover|PopoverPanel|PopoverBody)\b[^>]*\bclass="[^"]*\b(?:w-\d|max-w-|p-\d|px-\d|py-\d|max-h-\[|max-h-\d)/s;
    for (const file of panelComponents) {
      assert.ok(
        !frameOverride.test(file.source),
        `${file.name} overrides the panel frame (width, padding, or scroll height); use the size prop and the body region`,
      );
    }
  });
});
