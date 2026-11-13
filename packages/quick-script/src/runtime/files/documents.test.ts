import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classifyQuickScriptScript } from "../script-risk.js";
import { preludesFor } from "../sdk.js";
import { executeQuickScript } from "../quick-script.js";

type Nested = { toolName: string; args: Record<string, unknown> };

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "quick-script-files-"));
  const cwd = join(root, "workspace");
  const conversationDir = join(root, "conversation");
  const artifactDir = join(conversationDir, "quick-script");
  await mkdir(cwd);
  const authorized: Nested[] = [];
  const context = {
    cwd,
    conversationDir,
    authorizeNested: async (request: Nested) => {
      authorized.push(request);
    },
  };
  const run = (code: string) => executeQuickScript({ code }, context);
  return { cwd, artifactDir, authorized, run };
}

void test("document libraries and shims load only for scripts that mention them", () => {
  const sources = (code: string) =>
    preludesFor(code)
      .slice(1)
      .map((prelude) => prelude.source)
      .join("\n");
  assert.equal(preludesFor(`console.log(1)`).length, 1);
  assert.doesNotMatch(sources(`XLSX.read`), /g\.setImmediate/);
  assert.match(sources(`docx.Packer`), /g\.setImmediate/);
  assert.match(sources(`mammoth.convertToHtml`), /qsimg/);
  const pptx = sources(`await pptxText(bytes)`);
  assert.match(pptx, /defineProperty\(globalThis, "JSZip"/);
  assert.doesNotMatch(pptx, /"docx"/);
});

void test("docx and pptx survive files.write -> files.read and read back through mammoth and pptxText", async () => {
  const { run } = await setup();
  const result = await run(`
    const doc = new docx.Document({ sections: [{ children: [
      new docx.Paragraph({ text: "Quarterly report", heading: docx.HeadingLevel.HEADING_1 }),
      new docx.Paragraph({ children: [new docx.TextRun("Revenue grew — naïve café ✓")] }),
    ] }] });
    const word = await files.write("report.docx", await docx.Packer.pack(doc, "uint8array"));
    const wordBytes = await files.read(word, { as: "bytes" });
    const html = await mammoth.convertToHtml(wordBytes);
    const raw = await mammoth.extractRawText(wordBytes);
    console.log(html.value);
    console.log(raw.value.trim().replace(/\\n+/g, " | "));

    const deck = new PptxGenJS();
    deck.addSlide().addText("Roadmap & <plans>", { x: 1, y: 1, w: 6, h: 1 });
    const second = deck.addSlide();
    second.addText("Second slide", { x: 1, y: 1, w: 6, h: 1 });
    second.addNotes("Speaker says hi");
    const slides = await files.write("deck.pptx", await deck.write({ outputType: "uint8array" }));
    console.log(JSON.stringify(await pptxText(await files.read(slides, { as: "bytes" }))));
  `);

  const text = result.content ?? "";
  assert.match(text, /<h1>Quarterly report<\/h1>/);
  assert.match(text, /Revenue grew — naïve café ✓/);
  assert.match(text, /Quarterly report \| Revenue grew/);
  assert.match(
    text,
    /\{"index":1,"text":"Roadmap & <plans>","notes":""\},\{"index":2,"text":"Second slide","notes":"Speaker says hi"\}/,
  );
});

void test("mammoth replaces images with a placeholder unless convertImage is given", async () => {
  const { run } = await setup();
  const result = await run(`
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const doc = new docx.Document({ sections: [{ children: [
      new docx.Paragraph({ children: [new docx.TextRun("before "), new docx.ImageRun({ type: "png", data: png, transformation: { width: 10, height: 10 } })] }),
    ] }] });
    const bytes = await docx.Packer.pack(doc, "uint8array");
    console.log((await mammoth.convertToHtml(bytes)).value);
    console.log((await mammoth.convertToMarkdown(bytes)).value.trim());
    const custom = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, {
      convertImage: mammoth.images.imgElement(async () => ({ src: "x.png" })),
    });
    console.log(custom.value);
  `);

  const text = result.content ?? "";
  assert.match(text, /<p>before \[image: image\/png\]<\/p>/);
  assert.match(text, /\nbefore \[image: image\/png\]\n/);
  assert.match(text, /src="x.png"/);
  assert.doesNotMatch(text, /data:image/);
});

void test("document globals are harmless to the risk scanner", () => {
  const code = `const d = new docx.Document({ sections: [] }); await mammoth.convertToHtml(b); await pptxText(b); new PptxGenJS(); JSZip.loadAsync(b);`;
  assert.equal(classifyQuickScriptScript(code).risk, "read");
});

void test("PptxGenJS and JSZip can be used in the same script", async () => {
  const { run } = await setup();
  const result = await run(`
    const deck = new PptxGenJS();
    deck.addSlide().addText("Hi", { x: 1, y: 1, w: 2, h: 1 });
    const zip = await JSZip.loadAsync(await deck.write({ outputType: "uint8array" }));
    console.log(Object.keys(zip.files).includes("ppt/slides/slide1.xml"));
  `);
  assert.equal(result.content, "true\nexit 0");
});
