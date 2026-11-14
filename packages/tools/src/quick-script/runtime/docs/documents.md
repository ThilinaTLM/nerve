# Office documents and spreadsheets

Libraries load when the script mentions them. QuickJS has no JIT, so keep data to tens of thousands of rows. Files go through handles: `sdk.docs("files/handles")`.

## Excel and CSV

`XLSX` (SheetJS CE 0.20) and `Papa` (Papa Parse 5). Read bytes with `{ type: "array" }`; write with `XLSX.write(wb, { type: "array", bookType: "xlsx" })` straight into `files.write`.

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
// The handles go to any SDK method that takes a file.
console.log(xlsx, csv);
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
