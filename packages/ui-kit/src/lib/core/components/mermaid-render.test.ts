import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mermaidThemeVariables, type MermaidTheme } from "./mermaid-render";

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

describe("Mermaid theme variables", () => {
  it("uses themed surfaces for alternating ER attribute rows", () => {
    const variables = mermaidThemeVariables(theme);

    assert.equal(variables.attributeBackgroundColorOdd, theme.card);
    assert.equal(variables.attributeBackgroundColorEven, theme.background);
    assert.notEqual(variables.attributeBackgroundColorOdd, "#ffffff");
    assert.notEqual(variables.attributeBackgroundColorEven, "#f2f2f2");
  });

  it("preserves core diagram color mappings", () => {
    const variables = mermaidThemeVariables(theme);

    assert.equal(variables.primaryColor, theme.surface);
    assert.equal(variables.primaryTextColor, theme.foreground);
    assert.equal(variables.primaryBorderColor, theme.strongBorder);
    assert.equal(variables.lineColor, theme.mutedForeground);
  });
});
