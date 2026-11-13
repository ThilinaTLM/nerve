# Files and handles

A **handle** is `artifact:<name>` or a workspace path. Artifacts live in `$NERVE_HOME/data/conversations/<id>/quick-script/`, shared by all scripts of the conversation and kept across runs; each result prints `Artifacts: … in <folder>`, so the Read/Edit tools can open `<folder>/<name>` directly. Names: 1-128 letters (any language), digits, spaces, `.`, `_`, `-`; no folders, no leading dot. `files.write` takes `name` or `artifact:name`; a missing artifact lists the existing ones.

Permissions: workspace reads need `read`, `files.write(path, data, { workspace: true })` needs `write`, `files.edit(path, …)` needs `edit`; artifacts need none. One handle works everywhere (`files.*`, `image`, attachments, page `attachments`), also across runs. `web.fetch` files arrive as `artifact:web-N.ext`. Bytes: `files.read(h, { as: "bytes" })` (`Uint8Array`).

Limits: `files.read`/`files.write` {{limit:files.read}}; attachment upload/download and binary `request()` responses {{limit:attachments}} (streamed between disk and the network, never held in memory or the sandbox).

`files.edit(handle, [{ oldText, newText }])` works like the edit tool: each `oldText` matches exactly once, all edits apply or none.

Office documents and spreadsheets: `sdk.docs("libraries/documents")`. Image transforms: `sdk.docs("image/chain")`.
