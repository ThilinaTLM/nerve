import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectContent, runContentCheck } from "./check-content.mjs";

function fixture(files, publicFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), "nerve-doc-content-"));
  const contentRoot = join(root, "content");
  const publicRoot = join(root, "public");
  mkdirSync(contentRoot, { recursive: true });
  mkdirSync(publicRoot, { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    const path = join(contentRoot, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
  for (const [name, source] of Object.entries(publicFiles)) {
    const path = join(publicRoot, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, source);
  }
  return {
    contentRoot,
    publicRoot,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const page = (body, title = "Page", description = "A useful page.") =>
  `---\ntitle: ${title}\ndescription: ${description}\n---\n\n${body}\n`;

test("accepts normalized page, fragment, and public asset links", () => {
  const site = fixture(
    {
      "index.mdx": page("[Guide](/guide/#do-work)\n\n![Diagram](/diagram.svg)"),
      "guide.md": page("## Do work", "Guide"),
      "nested/source.md": page("[Guide](../guide.md#do-work)", "Source"),
    },
    { "diagram.svg": "<svg/>" },
  );
  try {
    assert.equal(runContentCheck(site), 3);
  } finally {
    site.cleanup();
  }
});

test("reports missing metadata, targets, and heading fragments", () => {
  const site = fixture({
    "index.md":
      "---\ntitle: Home\n---\n\n[Missing](/missing/)\n[Heading](/guide/#absent)",
    "guide.md": page("## Present", "Guide"),
  });
  try {
    const { errors } = inspectContent(site);
    assert(
      errors.some((error) => error.includes("missing frontmatter description")),
    );
    assert(
      errors.some((error) => error.includes("unresolved local link /missing/")),
    );
    assert(
      errors.some((error) =>
        error.includes("unresolved heading fragment /guide/#absent"),
      ),
    );
  } finally {
    site.cleanup();
  }
});

test("ignores links in fenced code and external URLs", () => {
  const site = fixture({
    "index.md": page(
      "[External](https://example.com/missing)\n\n```md\n[Example](/not-a-page/)\n```",
    ),
  });
  try {
    assert.deepEqual(inspectContent(site).errors, []);
  } finally {
    site.cleanup();
  }
});

test("detects routes duplicated by Markdown and MDX files", () => {
  const site = fixture({
    "guide.md": page("Text", "Guide"),
    "guide.mdx": page("Text", "Guide MDX"),
  });
  try {
    assert(
      inspectContent(site).errors.some((error) =>
        error.includes("duplicate route /guide/"),
      ),
    );
  } finally {
    site.cleanup();
  }
});
