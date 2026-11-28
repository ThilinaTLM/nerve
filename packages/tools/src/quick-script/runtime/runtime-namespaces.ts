import { FILES_DTS_TYPES, IMAGE_CHAIN_OPS } from "./files/dts-types.js";
import { LAUNCHES_DTS_TYPES } from "./launches/dts-types.js";
import { launchesMethods } from "./launches/launches-methods.js";
import { MCP_DTS_TYPES } from "./mcp/dts-types.js";
import { mcpMethods } from "./mcp/mcp-methods.js";
import { CONFIGURATION_DTS_TYPES } from "./configuration/dts-types.js";
import { configurationMethods } from "./configuration/configuration-methods.js";
import { EXTENSIONS_DTS_TYPES } from "./extensions/dts-types.js";
import { extensionsMethods } from "./extensions/extensions-methods.js";
import { artifactsMethods } from "./files/artifacts-methods.js";
import { filesMethods } from "./files/files-methods.js";
import { imageMethods } from "./files/image-methods.js";
import { WEB_DTS_TYPES } from "./web/dts-types.js";
import { webMethods } from "./web/web-methods.js";
import type { SdkNamespace } from "../manifest-types.js";

/**
 * quick_script's built-in capabilities, not extensions: no settings, always
 * present. `sdk` joins them in the registry.
 */

/** Globals of the document libraries (`libraries.ts` loads each when a script mentions it). */
export const LIBRARY_GLOBALS = [
  "XLSX",
  "Papa",
  "docx",
  "mammoth",
  "PptxGenJS",
  "pptxText",
  "JSZip",
] as const;

export const runtimeNamespaces: SdkNamespace[] = [
  {
    id: "files",
    summary: "workspace files: list, search, read, write, batch edit",
    methods: filesMethods,
    types: FILES_DTS_TYPES,
    docs: [
      {
        id: "files/editing",
        whenToRead:
          "before files.edit or artifacts.edit: edit shapes, match counts, transform",
        file: "editing.md",
      },
    ],
  },
  {
    id: "artifacts",
    summary: "this conversation's files: results, downloads, documents",
    methods: artifactsMethods,
    types: "",
    docs: [
      {
        id: "artifacts/handles",
        whenToRead:
          "before passing files between calls: handles, names, limits",
        file: "artifacts.md",
      },
    ],
  },
  {
    id: "image",
    summary: "image(handle).resize().png().save(name)",
    methods: imageMethods,
    types: "",
    callable: {
      chain: "ImageChain",
      steps: IMAGE_CHAIN_OPS,
      declaration: "declare function image(handle: FileHandle): ImageChain;",
    },
    docs: [
      {
        id: "image/chain",
        whenToRead: "before resizing, cropping or converting images",
        file: "images.md",
      },
    ],
  },
  {
    id: "web",
    summary: "fetch a URL as markdown, text, JSON or a file",
    rules: [
      "`web.fetch` content can be up to {{limit:web.fetch}}: slice before printing.",
    ],
    methods: webMethods,
    types: WEB_DTS_TYPES,
    docs: [],
  },
  {
    id: "extensions",
    summary:
      "status and reload of user and project extensions (configure-nerve skill)",
    methods: extensionsMethods,
    types: EXTENSIONS_DTS_TYPES,
    docs: [],
  },
  {
    id: "configuration",
    summary:
      "what is configured and in effect, why a call is allowed or prompted; validate and activate hand-edited files (configure-nerve skill)",
    methods: configurationMethods,
    types: CONFIGURATION_DTS_TYPES,
    docs: [],
  },
  {
    id: "launches",
    summary:
      "start, stop, logs and manage the project's dev servers, named by label (configure-nerve skill)",
    methods: launchesMethods,
    types: LAUNCHES_DTS_TYPES,
    docs: [],
  },
  {
    id: "mcp",
    listedWhenConfigured: true,
    summary:
      "tools and resources of the configured MCP servers; start with tools.search(query)",
    methods: mcpMethods,
    types: MCP_DTS_TYPES,
    docs: [
      {
        id: "mcp/usage",
        whenToRead: "before calling an MCP tool for the first time",
        file: "mcp.md",
      },
    ],
  },
  {
    id: "libraries",
    summary: LIBRARY_GLOBALS.join(", "),
    methods: [],
    types: "",
    docs: [
      {
        id: "libraries/documents",
        whenToRead:
          "before reading or writing Excel, CSV, Word or PowerPoint files",
        file: "documents.md",
      },
    ],
  },
];
