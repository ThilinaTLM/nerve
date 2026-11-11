# Files, images and libraries

Scripts work with files through **handles**: `artifact:<name>` names a file in the conversation's artifact folder (shared by all scripts of the conversation, listed in each result), anything else is a workspace path (relative to the working directory). Artifact names are 1-128 letters, digits, `.`, `_` or `-`, with no folders and no leading dot. Reading a workspace file is permission-checked like the `read` tool, writing one like the `write` tool; artifacts need no check. Files are limited to 20 MB.

## `files.list()`

Positional style like Node. Returns `{ handle, name, bytes, mediaType, modified }[]` for the conversation's artifacts.

## `files.read(handle, { as? })`

`as: "text"` (default) returns a UTF-8 string, `"bytes"` a `Uint8Array`.

## `files.write(name, data, { workspace? })`

`data` is a string, `Uint8Array` or `ArrayBuffer` (so `XLSX.write(wb, { type: "array", bookType: "xlsx" })` works directly). By default `name` is an artifact name and the result is its handle. With `workspace: true`, `name` is a workspace path (parent folders are created) and the resolved path is returned.

## `image(handle)`

A chain over the native image module; the bytes never enter the script. Each call returns the chain, except `info` and `save`:

- `.resize({ width?, height?, fit? })`: `fit` is `"inside"` (default, keeps the aspect ratio, never enlarges), `"cover"` or `"fill"`.
- `.crop({ left, top, width, height })`: runs before resize.
- `.png()` / `.jpeg({ quality? })`: output format; defaults to the input format when it is PNG or JPEG, else PNG.
- `.info()`: `{ format, width, height, bytes }` (after the pending operations).
- `.save(name)`: writes a new artifact and returns its handle.

```ts
const small = await image("./shot.png")
  .resize({ width: 760 })
  .png()
  .save("shot-760.png");
await confluence.attachments.upload({ id: pageId, file: small });
```

## `XLSX` and `Papa`

SheetJS (`XLSX.read(bytes, { type: "array" })`, `XLSX.utils.sheet_to_json`, `XLSX.utils.json_to_sheet`, `XLSX.write(wb, { type: "array", bookType: "xlsx" })`) and Papa Parse (`Papa.parse`, `Papa.unparse`) are globals, loaded only when the script mentions them. QuickJS does not JIT, so keep sheets to tens of thousands of rows and filter early.

```ts
const wb = XLSX.read(await files.read("./budget.xlsx", { as: "bytes" }), {
  type: "array",
});
return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
```
