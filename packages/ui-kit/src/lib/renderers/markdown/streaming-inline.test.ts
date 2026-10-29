import assert from "node:assert/strict";
import { describe, it } from "node:test";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import {
  MARK_CODE,
  MARK_EM,
  MARK_LINK,
  MARK_STRONG,
  MAX_OPTIMISTIC_TAIL_CHARS,
  type InlineToken,
  type StreamingBlock,
  splitRevealedMarkdown,
  tokenizeStreamingTail,
} from "./streaming-inline.js";

function inlineText(source: string, tokens: InlineToken[]): string {
  return tokens
    .map((token) =>
      token.kind === "break" ? "\n" : source.slice(token.start, token.end),
    )
    .join("");
}

function blockText(source: string, block: StreamingBlock): string {
  switch (block.kind) {
    case "plain":
    case "code":
      return source.slice(block.start, block.end);
    case "list":
      return block.items.map((item) => inlineText(source, item)).join(" ");
    case "quote":
      return block.paragraphs.map((item) => inlineText(source, item)).join(" ");
    default:
      return inlineText(source, block.inline);
  }
}

function visibleText(source: string): string {
  return tokenizeStreamingTail(source)
    .map((block) => blockText(source, block))
    .join(" ");
}

function marked(source: string, mark: number): string {
  const blocks = tokenizeStreamingTail(source);
  const tokens = blocks.flatMap((block) =>
    block.kind === "list"
      ? block.items.flat()
      : block.kind === "quote"
        ? block.paragraphs.flat()
        : block.kind === "plain" || block.kind === "code"
          ? []
          : block.inline,
  );
  return tokens
    .filter((token) => token.kind === "text" && (token.marks & mark) !== 0)
    .map((token) =>
      token.kind === "text" ? source.slice(token.start, token.end) : "",
    )
    .join("");
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The final render's pipeline (as in markdown-render.ts), stopped at the
// sanitized HTML tree so text is read from nodes, not by stripping markup.
const finalPipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize);

type TreeNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: TreeNode[];
};

const BLOCK_TAGS = new Set([
  "p",
  "li",
  "ul",
  "ol",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function treeText(node: TreeNode): string {
  if (node.type === "text") return node.value ?? "";
  const inner = (node.children ?? []).map(treeText).join("");
  return node.tagName && BLOCK_TAGS.has(node.tagName) ? ` ${inner} ` : inner;
}

function finalText(source: string): string {
  const tree = finalPipeline.runSync(finalPipeline.parse(source));
  return normalize(treeText(tree as TreeNode));
}

describe("tokenizeStreamingTail", () => {
  it("shows only the label of an unfinished link", () => {
    const source = "See the [full report](/tmp/nerve-luna-perf";
    assert.equal(visibleText(source), "See the full report");
    assert.equal(marked(source, MARK_LINK), "full report");
  });

  it("hides an unfinished label's bracket without styling it as a link", () => {
    const source = "Open [the docs";
    assert.equal(visibleText(source), "Open the docs");
    assert.equal(marked(source, MARK_LINK), "");
  });

  it("renders unclosed strong and emphasis optimistically", () => {
    assert.equal(marked("It is **really impor", MARK_STRONG), "really impor");
    assert.equal(marked("An *aside", MARK_EM), "aside");
    assert.equal(visibleText("It is **really impor"), "It is really impor");
  });

  it("holds back a trailing marker that may still open or close", () => {
    assert.equal(visibleText("Partial *"), "Partial ");
    assert.equal(visibleText("Partial **"), "Partial ");
    assert.equal(visibleText("Run `"), "Run ");
  });

  it("keeps intraword and spaced delimiters literal", () => {
    assert.equal(
      visibleText("snake_case_name and 2*3"),
      "snake_case_name and 2*3",
    );
    assert.equal(visibleText("a * b"), "a * b");
  });

  it("keeps escaped markers literal", () => {
    assert.equal(visibleText("not \\*emphasis\\* here"), "not *emphasis* here");
    assert.equal(marked("not \\*emphasis\\* here", MARK_EM), "");
  });

  it("does not apply marks inside inline code", () => {
    const source = "Use `a **b** c` now";
    assert.equal(marked(source, MARK_CODE), "a **b** c");
    assert.equal(marked(source, MARK_STRONG), "");
  });

  it("turns list items and headings at the tail start into blocks", () => {
    const list = tokenizeStreamingTail("- first\n- sec");
    assert.equal(list.length, 1);
    assert.equal(list[0]!.kind, "list");
    assert.equal(list[0]!.kind === "list" && list[0]!.items.length, 2);

    const ordered = tokenizeStreamingTail("3. third\n4. fou");
    assert.equal(ordered[0]!.kind === "list" && ordered[0]!.start, 3);

    const heading = tokenizeStreamingTail("## Findings so f");
    assert.equal(heading[0]!.kind, "heading");
    assert.equal(heading[0]!.kind === "heading" && heading[0]!.level, 2);
  });

  it("holds back a list or heading marker that has no space yet", () => {
    assert.equal(visibleText("Intro line\n-"), "Intro line");
    assert.equal(visibleText("Intro line\n##"), "Intro line");
  });

  it("renders an open code fence as code until it closes", () => {
    const source = "Intro\n```mermaid\nflowchart LR\n  A --> B\n";
    const blocks = tokenizeStreamingTail(source);
    assert.equal(blocks.at(-1)!.kind, "code");
    assert.equal(blockText(source, blocks.at(-1)!), "flowchart LR\n  A --> B");

    const code = blocks.at(-1)!;
    assert.equal(code.kind === "code" && code.mermaid, true);
    // The opener is held until its info string is complete.
    assert.deepEqual(tokenizeStreamingTail("```merm"), []);
  });

  it("renders a closed code fence as code and continues after it", () => {
    const source = "```ts\nconst a = 1\n```\nAfter";
    const blocks = tokenizeStreamingTail(source);
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["code", "paragraph"],
    );
    assert.equal(blockText(source, blocks[0]!), "const a = 1");
  });

  it("models blockquotes with paragraphs and lazy continuation", () => {
    const source = "> quote *em*\nlazy line\n>\n> second";
    const blocks = tokenizeStreamingTail(source);
    assert.equal(blocks.length, 1);
    const quote = blocks[0]!;
    assert.equal(quote.kind, "quote");
    assert.equal(quote.kind === "quote" && quote.paragraphs.length, 2);
    assert.equal(visibleText(source), "quote em\nlazy line second");
    assert.deepEqual(tokenizeStreamingTail(">"), []);
  });

  it("models task list items", () => {
    const source = "- [ ] open\n- [x] done\n- plain";
    const list = tokenizeStreamingTail(source)[0]!;
    assert.equal(list.kind, "list");
    assert.deepEqual(list.kind === "list" && list.tasks, [
      false,
      true,
      undefined,
    ]);
    assert.equal(visibleText(source), "open done plain");
    assert.equal(visibleText("- [ ] open\n- [x"), "open");
  });

  it("ends a block at a blank line", () => {
    const blocks = tokenizeStreamingTail("Last paragraph.\n\nNext wo");
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["paragraph", "paragraph"],
    );
  });

  it("holds back a bare number that may become an ordered list", () => {
    assert.equal(visibleText("Intro line\n1"), "Intro line");
    assert.deepEqual(tokenizeStreamingTail("1"), []);
  });

  it("falls back to plain text for unmodelled blocks", () => {
    for (const source of ["| a | b |", "> - nested list"]) {
      const blocks = tokenizeStreamingTail(source);
      assert.equal(blocks.at(-1)!.kind, "plain", source);
    }
    const long = "x".repeat(MAX_OPTIMISTIC_TAIL_CHARS + 1);
    assert.deepEqual(tokenizeStreamingTail(long), [
      { kind: "plain", start: 0, end: long.length },
    ]);
  });

  it("produces ordered, in-bounds offsets for every streamed prefix", () => {
    for (const source of CORPUS) {
      for (let length = 0; length <= source.length; length += 1) {
        const prefix = source.slice(0, length);
        let cursor = 0;
        for (const block of tokenizeStreamingTail(prefix)) {
          const tokens =
            block.kind === "plain" || block.kind === "code"
              ? [
                  {
                    kind: "text" as const,
                    start: block.start,
                    end: block.end,
                    marks: 0,
                  },
                ]
              : block.kind === "list"
                ? block.items.flat()
                : block.kind === "quote"
                  ? block.paragraphs.flat()
                  : block.inline;
          for (const token of tokens) {
            if (token.kind !== "text") continue;
            assert.ok(token.start >= cursor, `${prefix}: overlap`);
            assert.ok(token.end > token.start && token.end <= length, prefix);
            cursor = token.end;
          }
        }
      }
    }
  });

  it("matches the final render's text once constructs are closed", () => {
    for (const source of CORPUS) {
      assert.equal(normalize(visibleText(source)), finalText(source), source);
    }
  });
});

describe("splitRevealedMarkdown", () => {
  it("keeps a finished block in the tail until the next one is visible", () => {
    for (const pending of ["", "#", "##", "1", "1.", "-"]) {
      const source = `Done.\n\nLast paragraph.\n\n${pending}`;
      assert.deepEqual(splitRevealedMarkdown(source), {
        prefix: "Done.\n\n",
        tail: `Last paragraph.\n\n${pending}`,
      });
    }
  });

  it("advances once the next block has visible content", () => {
    const source = "Done.\n\nLast paragraph.\n\n## Next";
    assert.deepEqual(splitRevealedMarkdown(source), {
      prefix: "Done.\n\nLast paragraph.\n\n",
      tail: "## Next",
    });
  });

  it("never pulls an unmodelled block back into the tail", () => {
    const source = "| a | b |\n\n#";
    assert.deepEqual(splitRevealedMarkdown(source), {
      prefix: "| a | b |\n\n",
      tail: "#",
    });
  });
});

const CORPUS = [
  "Recreated the [full performance report](/tmp/report.md) from the results.",
  "It includes real **Luna engineering workflows**, *timings*, and `3/3` calls.",
  "Mixed ***strong em*** and ~~struck~~ text with a [`code label`](x.ts) link.",
  "- No persistent UI freeze across `3/3` calls.\n- Large histories stayed **responsive**.",
  "1. first step\n2. second step with [a link](https://example.com)",
  "## Key findings",
  "Line one\nline two continues the paragraph",
  "Escaped \\*stars\\* and snake_case stay literal.",
  "> A *quoted* line\n> that continues",
  "- [ ] open task\n- [x] **done** task",
  "```ts\nconst answer = 42;\n```",
];
