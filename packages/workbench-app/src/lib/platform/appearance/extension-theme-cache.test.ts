import assert from "node:assert/strict";
import test from "node:test";
import { themeTokenNames } from "@nervekit/contracts/extensions";
import {
  extensionThemeRule,
  parseExtensionThemeCache,
  parseThemeTokens,
  reconcileSelectedTheme,
  serializeExtensionThemeCache,
  type ExtensionThemeData,
} from "./extension-theme-cache";

const tokens = Object.fromEntries(
  themeTokenNames.map((name) => [name, "#112233"]),
) as ExtensionThemeData["tokens"];
const theme: ExtensionThemeData = {
  id: "ext:solar/dusk",
  kind: "dark",
  tokens,
  background: "#112233",
};

test("rules carry tokens only, for the root and previews", () => {
  const rule = extensionThemeRule(theme.id, tokens);
  assert.ok(
    rule.startsWith(
      ':root[data-theme="ext:solar/dusk"],[data-theme-preview="ext:solar/dusk"]{--background:#112233;',
    ),
  );
  assert.equal(rule.match(/\{/g)?.length, 1);
  assert.equal(extensionThemeRule("nerve-dark" as never, tokens), "");
});

test("tokens with unsafe values are rejected", () => {
  assert.ok(parseThemeTokens(tokens));
  assert.equal(
    parseThemeTokens({ ...tokens, primary: "red; } body { display:none" }),
    undefined,
  );
  assert.equal(parseThemeTokens({ ...tokens, primary: "url(x)" }), undefined);
  assert.equal(parseThemeTokens({ ...tokens, extra: "#fff" }), undefined);
});

test("the cache round-trips and rejects damaged entries", () => {
  const raw = serializeExtensionThemeCache(theme);
  assert.deepEqual(parseExtensionThemeCache(raw), theme);
  assert.equal(JSON.parse(raw).css, extensionThemeRule(theme.id, tokens));
  assert.equal(parseExtensionThemeCache(null), undefined);
  assert.equal(parseExtensionThemeCache("{"), undefined);
  assert.equal(
    parseExtensionThemeCache(raw.replace('"dark"', '"blue"')),
    undefined,
  );
  assert.equal(
    parseExtensionThemeCache(raw.replace('#112233","tokens', 'red","tokens')),
    undefined,
  );
  assert.equal(
    parseExtensionThemeCache(raw.replace("ext:solar/dusk", "nerve-dark")),
    undefined,
  );
});

test("a missing extension theme falls back to the default", () => {
  assert.equal(
    reconcileSelectedTheme("ext:solar/dusk", [theme]),
    "ext:solar/dusk",
  );
  assert.equal(reconcileSelectedTheme("ext:solar/dusk", []), "nerve-dark");
  assert.equal(reconcileSelectedTheme("graphite", []), "graphite");
  // The preference is an input, not rewritten: it applies again when the theme returns.
  assert.equal(
    reconcileSelectedTheme("ext:solar/dusk", [theme]),
    "ext:solar/dusk",
  );
});
