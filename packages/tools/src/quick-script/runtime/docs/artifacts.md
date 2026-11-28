# Artifacts and handles

Artifacts are this conversation's own files: script results, downloads (`web.fetch` files arrive as `artifact:web-N.ext`) and generated documents. They live in `$NERVE_HOME/data/conversations/<id>/quick-script/`, are shared by all scripts of the conversation and kept across runs. Each result prints `Artifacts: … in <folder>`, so the Read/Edit tools can open `<folder>/<name>` directly. Artifacts need no permission.

`artifacts.*` takes a name or an `artifact:<name>` handle. Names: 1-128 letters (any language), digits, spaces, `.`, `_`, `-`; no folders, no leading dot. A missing artifact lists the existing ones. Workspace files go through `files.*`, checked like the read, write and edit tools.

A **handle** is `artifact:<name>` or a workspace path. Methods that take any file (`image(…)`, attachments, page `attachments`) accept both, also across runs.

Limits: `artifacts.read`/`artifacts.write` and `files.read`/`files.write` {{limit:files.read}}; attachment upload/download and binary `request()` responses {{limit:attachments}} (streamed between disk and the network, never held in memory or the sandbox).

`artifacts.edit({ name, edits })` takes the edits of `files.edit`: `sdk.docs("files/editing")`. Office documents and spreadsheets: `sdk.docs("libraries/documents")`. Image transforms: `sdk.docs("image/chain")`.
