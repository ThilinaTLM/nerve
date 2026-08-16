import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  mermaidThemeVariables,
  rewriteMermaidSvgIdReferences,
  type MermaidTheme,
} from "./mermaid-render";

const theme: MermaidTheme = {
  fingerprint: "dark-theme",
  dark: true,
  fontFamily: "Outfit",
  background: "#242424",
  foreground: "#e5e5e5",
  card: "#2b2b2b",
  surface: "#3d3d3d",
  primary: "#f0c674",
  border: "#555555",
  strongBorder: "#777777",
  mutedForeground: "#aaaaaa",
};

describe("Mermaid SVG ID references", () => {
  it("scopes fragment references without confusing ID prefixes", () => {
    const ids = new Map([
      ["arrow", "mount-1-arrow"],
      ["arrowhead", "mount-1-arrowhead"],
    ]);

    assert.equal(
      rewriteMermaidSvgIdReferences(
        "marker-end: url(#arrowhead); fill: url(#arrow); href: #arrow",
        ids,
      ),
      "marker-end: url(#mount-1-arrowhead); fill: url(#mount-1-arrow); href: #mount-1-arrow",
    );
  });
});

describe("Mermaid theme variables", () => {
  it("uses themed surfaces for alternating ER attribute rows", () => {
    const variables = mermaidThemeVariables(theme);

    assert.equal(variables.rowOdd, theme.card);
    assert.equal(variables.rowEven, theme.background);
    assert.notEqual(variables.rowOdd, "#ffffff");
    assert.notEqual(variables.rowEven, "#f2f2f2");
  });

  it("preserves core diagram color mappings", () => {
    const variables = mermaidThemeVariables(theme);

    assert.equal(variables.primaryColor, theme.surface);
    assert.equal(variables.primaryTextColor, theme.foreground);
    assert.equal(variables.primaryBorderColor, theme.strongBorder);
    assert.equal(variables.lineColor, theme.mutedForeground);
  });
});
