import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  SYNTAX_TOKEN_ROLES,
  syntaxTheme,
  type SyntaxTokenRole,
} from "./syntax-theme";

const themeCss = readFileSync(
  fileURLToPath(new URL("../../styles/theme.css", import.meta.url)),
  "utf8",
);

function themeColorValues(): string[] {
  return [
    ...Object.values(syntaxTheme.colors),
    ...syntaxTheme.tokenColors.flatMap((token) =>
      token.settings.foreground ? [token.settings.foreground] : [],
    ),
  ];
}

describe("syntax theme", () => {
  it("paints only with CSS variables so a theme switch never re-tokenizes", () => {
    for (const value of themeColorValues()) {
      if (value === "transparent") continue;
      assert.match(
        value,
        /^var\(--syntax-[a-z-]+\)$/,
        `Shiki theme uses the fixed colour '${value}'; baked colours would need a re-highlight on every theme change`,
      );
    }
  });

  it("references only roles that theme.css defines", () => {
    const roles = new Set<string>(SYNTAX_TOKEN_ROLES);
    for (const value of themeColorValues()) {
      const role = value.match(/^var\(--syntax-([a-z-]+)\)$/)?.[1];
      if (!role) continue;
      assert.ok(
        roles.has(role),
        `Shiki theme paints undeclared role '${role}'`,
      );
    }

    for (const role of SYNTAX_TOKEN_ROLES) {
      assert.ok(
        themeCss.includes(`--syntax-${role}:`),
        `theme.css defines no --syntax-${role}; code painted with it would fall back to inherited colour`,
      );
    }
  });

  it("assigns every declared role to at least one scope", () => {
    const used = new Set<SyntaxTokenRole>();
    for (const value of themeColorValues()) {
      const role = value.match(/^var\(--syntax-([a-z-]+)\)$/)?.[1];
      if (role) used.add(role as SyntaxTokenRole);
    }
    for (const role of SYNTAX_TOKEN_ROLES) {
      assert.ok(used.has(role), `--syntax-${role} is declared but unused`);
    }
  });
});
