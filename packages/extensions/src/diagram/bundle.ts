import { diagramExtension } from "./manifest.js";

/** Entry of the sandbox bundle (`scripts/build/copy-extension-assets.ts`): registers the definition for the runtime library. */
(globalThis as { __nerveExtension?: unknown }).__nerveExtension =
  diagramExtension;
