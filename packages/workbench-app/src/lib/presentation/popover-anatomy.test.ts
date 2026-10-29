import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* Floating panels share PopoverPanel's frame: titled content has one header;
 * command-style selectors may start directly with their labeled search/list.
 * Both have one scrolling body and an optional footer. The panel owns its width,
 * padding, and scroll bounds, so consumers must not restate that chrome. */

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const PANEL_IMPORT = "components/composites/popover-panel";

/* Design Lab contains specimens and local prototypes (including bare headers
 * and variants), not product UI. */
const catalogDir = path.join(appRoot, "app", "design-lab");

function svelteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full === catalogDir) continue;
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

  it("titles content once or uses a labeled command list", () => {
    // Fragments that only contribute sections to a panel have no header.
    const panels = panelComponents.filter((file) =>
      /<(?:Popover|PopoverPanel)\b/.test(file.source),
    );
    for (const file of panels) {
      let headerSource = file.source;
      if (
        file.name ===
        path.join(
          "features/settings/views/pages/agent-profiles",
          "ProfileChangeChip.svelte",
        )
      ) {
        // The chip owns the trigger; its shared editor owns the titled content.
        const editors =
          file.source.match(/<ProfileChangeEditor(?=\s|\/>)/g) ?? [];
        assert.equal(editors.length, 1, "the chip renders one change editor");
        assert.match(
          file.source,
          /<ProfileChangeEditor\b[^>]*\btitle=\{label\}/s,
        );
        const editor = components.find(
          (component) =>
            component.name ===
            path.join(path.dirname(file.name), "ProfileChangeEditor.svelte"),
        );
        assert.ok(editor, "the shared change editor exists");
        assert.match(editor.source, /<PopoverHeader\b[^>]*\{title\}/s);
        headerSource += editor.source;
      }
      const headers = headerSource.match(/<PopoverHeader\b/g) ?? [];
      if (headers.length === 0) {
        // Command selectors already identify their choices via the searchable
        // list; repeating that label in a visible header is unnecessary.
        const commands =
          headerSource.match(/<PopoverCommandList\b[^>]*>/gs) ?? [];
        assert.ok(
          commands.length > 0,
          `${file.name} has neither a PopoverHeader nor a command list`,
        );
        for (const command of commands) {
          assert.match(
            command,
            /\bariaLabel=/,
            `${file.name} must label its headerless command list`,
          );
        }
      } else {
        assert.equal(
          headers.length,
          1,
          `${file.name} declares ${headers.length} PopoverHeader elements; a panel is titled once`,
        );
      }
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
