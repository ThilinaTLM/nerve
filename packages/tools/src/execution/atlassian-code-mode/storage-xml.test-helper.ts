import assert from "node:assert/strict";

/** Tiny well-formedness check: balanced tags, CDATA skipped, entities valid. */
export function assertWellFormedStorage(xml: string): void {
  const stack: string[] = [];
  const stripped = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const tokens = stripped.match(/<[^>]*>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      assert.doesNotMatch(
        token.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, ""),
        /[&]/,
        `bare ampersand in text: ${token}`,
      );
      continue;
    }
    const close = /^<\/([\w:-]+)\s*>$/.exec(token);
    if (close) {
      assert.equal(
        stack.pop(),
        close[1],
        `unbalanced </${close[1]}> in ${xml}`,
      );
      continue;
    }
    const open = /^<([\w:-]+)(\s[^>]*?)?(\/?)>$/.exec(token);
    assert.ok(open, `malformed tag ${token}`);
    const attrs = open[2] ?? "";
    assert.doesNotMatch(
      attrs.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, ""),
      /&/,
      `bare ampersand in attributes: ${token}`,
    );
    if (!open[3]) stack.push(open[1]);
  }
  assert.deepEqual(stack, [], `unclosed tags in ${xml}`);
}
