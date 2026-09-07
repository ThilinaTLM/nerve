import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/* IconAction is wrapped by bits-ui triggers (tooltip always, popover when the
 * action opens one). Both hand their wiring over as props that must reach a DOM
 * node intact, and both failures below were silent: the control still rendered
 * and still looked right, it just stopped doing anything. */
const source = readFileSync(
  fileURLToPath(new URL("./icon-action.svelte", import.meta.url)),
  "utf8",
);

describe("icon action trigger wiring", () => {
  it("spreads trigger props onto a DOM element, never onto a component", () => {
    /* Spreading onto <Button> drops the attachment bits-ui uses to track the
     * node, which silently removed every settings icon tooltip. */
    assert.match(
      source,
      /<span\s+\{\.\.\.props\}\s+\{\.\.\.rest\}/,
      "tooltip and wrapper props should land on the span",
    );
    assert.doesNotMatch(
      source,
      /<Button[^>]*\{\.\.\.(props|rest)\}/s,
      "trigger props must not be spread onto the Button component",
    );
  });

  it("forwards the click event to the handler", () => {
    /* A wrapper's own onclick arrives as this prop. Calling it with no
     * argument left popover triggers inert. */
    assert.match(
      source,
      /onclick=\{\(event\) => onclick\?\.\(event\)\}/,
      "onclick should be invoked with its event",
    );
  });
});
