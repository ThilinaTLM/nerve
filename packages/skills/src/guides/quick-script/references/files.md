# Files, images, spreadsheets, diagrams

Types: [files.d.ts](files.d.ts).

A **handle** is `artifact:<name>` (this conversation's artifact folder, shared by all scripts and listed in each result) or a workspace path. Artifact names: 1-128 letters, digits, `.`, `_`, `-`; no folders. Max 20 MB per file. Reading a workspace file needs `read` permission, `files.write(path, data, { workspace: true })` needs `write`; artifacts need none. One handle works everywhere: `files.read`, `image`, `confluence.attachments.upload`, page `attachments`. Artifacts persist, so render in one run and attach in the next.

## Excel and CSV

`XLSX` (SheetJS CE 0.20) and `Papa` (Papa Parse 5) are the standard libraries. Sandbox specifics: read bytes with `files.read(h, { as: "bytes" })` and pass `{ type: "array" }`; write with `XLSX.write(wb, { type: "array", bookType: "xlsx" })` straight into `files.write`; keep sheets to tens of thousands of rows (no JIT).

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
