# Files, documents, images, diagrams

Types: [files.d.ts](files.d.ts), [web.d.ts](web.d.ts).

A **handle** is `artifact:<name>` or a workspace path. Artifacts live in `$NERVE_HOME/data/conversations/<id>/quick-script/`, shared by all scripts of the conversation and kept across runs; each result prints `Artifacts: … in <folder>`, so the Read/Edit tools can open `<folder>/<name>` directly. Names: 1-128 letters (any language), digits, spaces, `.`, `_`, `-`; no folders, no leading dot. `files.write` takes `name` or `artifact:name`; a missing artifact lists the existing ones.

Permissions: workspace reads need `read`, `files.write(path, data, { workspace: true })` needs `write`, `files.edit(path, …)` needs `edit`; artifacts need none. One handle works everywhere: `files.read`, `files.edit`, `image`, attachments upload/download, page `attachments`. Render in one run, attach in the next. `web.fetch` files arrive as `artifact:web-N.ext`; downloads keep the original file name when valid. Read bytes with `files.read(h, { as: "bytes" })` (a `Uint8Array`).

Limits: `files.read`/`files.write` 20 MB; attachment upload/download and binary `request()` responses 100 MB (streamed between disk and the network, never held in memory or the sandbox).

`files.edit(handle, [{ oldText, newText }])` works like the edit tool: each `oldText` must match exactly once in the original, all edits apply or none. Libraries load when the script mentions them; QuickJS has no JIT, so keep data to tens of thousands of rows.

## Excel and CSV

`XLSX` (SheetJS CE 0.20) and `Papa` (Papa Parse 5) are the standard libraries. Sandbox specifics: pass the bytes with `{ type: "array" }`; write with `XLSX.write(wb, { type: "array", bookType: "xlsx" })` straight into `files.write`.

```ts
const wb = XLSX.read(await files.read("./budget.xlsx", { as: "bytes" }), {
  type: "array",
});
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
```

```ts
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Sprint");
const xlsx = await files.write(
  "sprint.xlsx",
  XLSX.write(book, { type: "array", bookType: "xlsx" }),
);
const csv = await files.write("sprint.csv", Papa.unparse(rows));
await confluence.attachments.upload({
  id: pageId,
  file: xlsx,
  comment: "Sprint export",
});
```

## Word

Write with `docx`, read with `mammoth`. Pack with `"uint8array"` (never `toBuffer`/`toBlob`). Images in the source become `[image: type]` unless you pass `convertImage`.

```ts
const doc = new docx.Document({
  sections: [{ children: [new docx.Paragraph("Hello")] }],
});
await files.write("hello.docx", await docx.Packer.pack(doc, "uint8array"));
const bytes = await files.read("artifact:hello.docx", { as: "bytes" });
const text = (await mammoth.extractRawText(bytes)).value; // or convertToMarkdown(bytes)
```

`mammoth` accepts a `Uint8Array`, an `ArrayBuffer` or `{ arrayBuffer }`.

## PowerPoint

Write with `PptxGenJS`, read slide text and notes with `pptxText`. `JSZip` is available for anything else.

```ts
const deck = new PptxGenJS();
const slide = deck.addSlide();
slide.addText("Q3 review", { x: 1, y: 1, w: 6, h: 1, fontSize: 32 });
slide.addNotes("Say hi");
await files.write("deck.pptx", await deck.write({ outputType: "uint8array" }));
const { slides } = await pptxText(
  await files.read("artifact:deck.pptx", { as: "bytes" }),
); // { index, text, notes }[]
```

## Images

`image(handle)` is a chain; bytes stay on the host. Steps build operations (crop runs before resize), `info()` and `save(name)` execute. Confluence takes PNG/JPEG as is, converts GIF/WebP to PNG, rejects SVG; aim for about 760 px wide.

```ts
const small = await image("./shot.png")
  .resize({ width: 760 })
  .png()
  .save("shot-760.png");
```

## Diagrams

`diagram.render` sends the source (max 128 KiB) to the configured Kroki server and returns a PNG artifact. Use short labels and vertical layouts (`flowchart TB`) so the PNG is close to 760 px wide.

```ts
const flow = await diagram.render({
  type: "mermaid",
  source: "flowchart TB\n  A[Plan] --> B[Ship]",
  name: "flow.png",
});
const { width } = await image(flow).info();
```
