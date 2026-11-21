# Upgrading extensions

One section per SDK version that breaks extensions, newest first. The SDK shares Nerve's version; a section exists only for versions that change the extension API, the UI bridge, the manifest format, `ui-kit` components or theme token names (the versions that raise a floor of Nerve's `oldestCompatibleSdkVersion`, which has one floor per surface: `manifest`, `backend`, `ui`, `themes`). Name the surface in the section so the agent can skip sections that do not touch the extension. `test/public-surface.test.ts` fails on any change to the public surface until you decide: additive (update its snapshot), or breaking (raise the floor, add a section here, update the snapshot).

To upgrade an extension from SDK `A` to SDK `B`: apply every section with `A < version <= B`, oldest first, then bump `@nervekit/extension-sdk` in `package.json` to `B` (exact version) and run `npm install` and `npx nerve-ext check`. `npm view @nervekit/extension-sdk dist-tags` shows the stable (`latest`) and staging (`next`) versions; target staging only when the extension needs a Nerve staging host.

## Section format

Copy this block above the previous section when a release breaks extensions.

````md
## X.Y.Z

What changed, in one or two sentences, and who is affected.

**Before**

```ts
// code that worked with the previous version
```

**After**

```ts
// the same code for X.Y.Z
```

Mechanical steps, if the change cannot be read from the code above (renamed files, new manifest fields, changed commands).
````

<!-- Sections start here. None yet: every released SDK version is compatible with the previous one. -->
