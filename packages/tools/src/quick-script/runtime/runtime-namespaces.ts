import { FILES_DTS_TYPES, IMAGE_CHAIN_OPS } from "./files/dts-types.js";
import { LAUNCHES_DTS_TYPES } from "./launches/dts-types.js";
import { launchesMethods } from "./launches/launches-methods.js";
import { CONFIGURATION_DTS_TYPES } from "./configuration/dts-types.js";
import { configurationMethods } from "./configuration/configuration-methods.js";
import { EXTENSIONS_DTS_TYPES } from "./extensions/dts-types.js";
import { extensionsMethods } from "./extensions/extensions-methods.js";
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
    summary: "artifact:<name> or workspace paths; read, write, edit, list",
    methods: filesMethods,
    types: FILES_DTS_TYPES,
    docs: [
      {
        id: "files/handles",
        whenToRead:
          "before reading or writing files: handles, permissions, limits",
        file: "files.md",
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
    rules: ["`web.fetch` content can be up to 8 MiB: slice before printing."],
    methods: webMethods,
    types: WEB_DTS_TYPES,
    docs: [],
  },
  {
    id: "extensions",
    summary:
      "reload(id), status(id) for user and project extensions, built with the configure-nerve skill",
    methods: extensionsMethods,
    types: EXTENSIONS_DTS_TYPES,
    docs: [],
  },
  {
    id: "configuration",
    summary:
      'check(scope), reload(scope) with scope "user" or "project": validate hand-edited agent.json, profiles, permission files, rule sets and launch definitions, then activate them; see the configure-nerve skill',
    methods: configurationMethods,
    types: CONFIGURATION_DTS_TYPES,
    docs: [],
  },
  {
    id: "launches",
    summary:
      "list, create, update, remove, folders.create, move: the project's launch definitions; see the configure-nerve skill",
    methods: launchesMethods,
    types: LAUNCHES_DTS_TYPES,
    docs: [],
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
