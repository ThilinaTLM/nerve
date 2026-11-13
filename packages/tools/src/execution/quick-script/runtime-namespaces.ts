import { FILES_DTS_TYPES, IMAGE_CHAIN_OPS } from "./files/dts-types.js";
import { filesMethods } from "./files/files-methods.js";
import { imageMethods } from "./files/image-methods.js";
import type { SdkNamespace } from "./extensions/manifest-types.js";

/**
 * Namespaces that are part of the `quick_script` runtime, not extensions: no
 * settings, always present. `sdk` joins them in the registry.
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
