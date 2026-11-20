/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
/* The extension definition: methods, namespaces, direct tools, UI contributions. */
import type { AuthorizeResult, Risk } from "./authorization.js";
import type { AccountKind, ExtensionSettings } from "./settings.js";
import type { ExtensionContext } from "./types.js";

// ── Methods, namespaces, tools ───────────────────────────────────────────────

/**
 * A method of a namespace: scripts call it as `<namespace>.<method>(...)`. Create it with
 * `method()`. The call runs `parse` → `authorize` → (approval, when the policy asks) → `run`;
 * `parse` and `authorize` are synchronous and pure, so a bad or denied call never causes I/O.
 * Method names (the keys of `NamespaceDefinition.methods`) are lower camelCase and may be dotted
 * (`pages.get`).
 */
export type MethodDefinition<
  Session = unknown,
  Input = unknown,
  Output = unknown,
> = {
  /** The most the method can do; the permission engine and the script scanner start from it. Use the lowest true value. */
  risk: Risk;
  /**
   * The risk depends on argument values (a raw request: `GET` reads, anything else writes), so
   * `authorize` returns the call's own risk (never above `risk`). The script scanner needs literal
   * arguments to decide it; a call whose arguments it cannot read counts as destructive and is
   * not handed to operation rules.
   */
  riskFromArgs?: boolean;
  /**
   * TypeScript method declaration, optionally led by a one-line JSDoc comment (at most 300
   * characters for installed extensions); generates what `sdk.describe` and `sdk.search` serve.
   * Methods take one argument: a bare string or an options object (see `parseOptions`).
   */
  signature: string;
  /** Validates the script's positional arguments (a direct tool bound to the method passes its arguments object as the single argument) and returns the typed input; throws `ExtensionError("BAD_REQUEST", …)` on bad input. Synchronous and pure. */
  parse(args: readonly unknown[]): Input;
  /** What the call is authorized as: one check, several (all must pass) or `undefined` for none beyond `risk`. Synchronous and pure, so it runs before any I/O. */
  authorize?(input: Input): AuthorizeResult;
  /** What a 403 refers to, e.g. `project APP`; defaults to the authorization summary. */
  resource?(input: Input): string;
  /** Does the work and returns plain data (JSON values, `Uint8Array`, `ArtifactRef`). `session` is the namespace's session; take `ctx` from here, not from the session. */
  run(
    session: Session,
    input: Input,
    ctx: ExtensionContext,
  ): Promise<Output> | Output;
};

/** The reason an optional `availability` hook gives when a namespace or tool cannot be used. */
export type Availability =
  | {
      /** The namespace or tool can be used. */
      available: true;
    }
  | {
      /** The namespace or tool cannot be used right now. */
      available: false;
      /** Why, as the agent sees it. */
      reason: string;
      /** What the user must do ("Ask the user to …"). */
      fix: string;
    };

/** A doc topic: a Markdown file the agent reads on demand (`sdk.docs`) instead of loading it into every prompt. */
export type DocTopic = {
  /** Full topic id (`jira/workflows`): lower-case letters, digits, `_`, `-` and `/`. */
  id: string;
  /** When to read it; at most 160 characters for installed extensions. */
  whenToRead: string;
  /** Path of the Markdown file inside the extension project, under `docs/` (`docs/workflows.md`); `nerve-ext build` copies `docs/` to `dist/docs/`. At most 24,000 characters. */
  file: string;
};

/** Conditions that must hold for a namespace or tool to be offered. */
export type Requires = {
  /** Name of an `account` setting that must point at an existing account with a saved secret. */
  account?: string;
};

/**
 * A `quick_script` namespace: a global object (`jira`) whose methods scripts call. The text
 * fields (`summary`, `rules`, signatures, `docs`) are what the agent reads, so keep them short;
 * installed extensions have length limits (see each member). Namespace ids may not equal a
 * runtime namespace (`files`, `image`, `web`, `extensions`, `sdk`, `libraries`) or a JavaScript
 * global (`console`, `JSON`, …), and are unique across all extensions.
 */
export type NamespaceDefinition<Session = unknown> = {
  /** Global name in the sandbox: `jira`. Starts with a lower-case letter, letters and digits only, at most 32 characters. */
  id: string;
  /** Title on the Extensions page; the id when absent. */
  label?: string;
  /** Boolean setting of the extension that switches this namespace, or several (any one enables it). Absent: it follows the extension. */
  enabledBy?: string | readonly string[];
  /** The namespace is offered only while this holds. */
  requires?: Requires;
  /** A supporting namespace (`storage` builders, a site `defaults()`): usable by scripts, not listed to the user. */
  helper?: boolean;
  /** One line in the `quick_script` description. At most 200 characters for installed extensions. */
  summary: string;
  /** At most three short lines (300 characters each for installed extensions), added to the description whenever the namespace is configured. */
  rules?: readonly string[];
  /** Shared TypeScript declarations for `sdk.describe`: the shapes methods return. */
  types: string;
  /** Doc topics of the namespace. */
  docs?: readonly DocTopic[];
  /** Once per quick_script run, on first use; holds clients and caches. Keep plain data in it, never `ctx`. Hook: written as `true` in the manifest. */
  session?: (ctx: ExtensionContext) => Promise<Session> | Session;
  /** Methods by name; created with `method()`. */
  methods: Readonly<Record<string, MethodDefinition<Session, any, any>>>;
  /** One line `sdk.describe` prints above the declarations: how the namespace is configured now. Hook: written as `true` in the manifest. */
  configuration?: (ctx: ExtensionContext) => string | undefined;
  /** Extra checks the declarations cannot express (a service unreachable, a missing model). Hook: written as `true` in the manifest. */
  availability?: (
    ctx: ExtensionContext,
  ) => Promise<Availability> | Availability;
};

/**
 * How a section of a direct tool's card renders its value; the app has one
 * renderer per type. `text` and `markdown`: a string. `links`:
 * `{ title, url, snippet? }[]`. `table`: rows of records, or
 * `{ columns, rows }`. `artifacts`: artifact handles or references (absent:
 * every artifact the call wrote).
 */
export type ViewSectionType =
  | "text"
  | "markdown"
  | "links"
  | "table"
  | "artifacts";

/** Every `ViewSectionType`, in display-documentation order. */
export const VIEW_SECTION_TYPES: readonly ViewSectionType[] = [
  "text",
  "markdown",
  "links",
  "table",
  "artifacts",
];

/** Section ids: lower-case letter first, then letters, digits, `_` or `-`, at most 32 characters; also the stream ids `ctx.progress` writes to. */
export const VIEW_SECTION_ID = /^[a-z][a-z0-9_-]{0,31}$/;

/** One block of a direct tool's card. */
export type ViewSection = {
  /** Unique per tool; matches `VIEW_SECTION_ID`. */
  id: string;
  /** How the value renders. */
  type: ViewSectionType;
  /** Small title (1–64 characters), shown when the card has more than one visible section. */
  label?: string;
  /**
   * Text a running call streams into the section with `ctx.progress` (`text`
   * and `markdown` only): `stream` is replaced by the final value, `transient`
   * is shown only while the call runs (thinking).
   */
  live?: "stream" | "transient";
};

/**
 * How the transcript card shows a direct tool, in every state: the header and
 * facts come from the arguments (drafting, approval, running, done), the
 * sections from live progress and the result. The app renders it with its own
 * components; an extension ships no UI code.
 */
export type ToolView = {
  /** The argument the card header shows; `path` resolves it against the working directory and makes it openable. */
  header?: {
    /** Name of an argument in the tool's `parameters`. */
    argument: string;
    /** `text` (default) or `path`. */
    format?: "text" | "path";
  };
  /** Arguments shown as small facts after the header (at most 3). */
  meta?: readonly string[];
  /** At least one section, in display order. */
  sections: readonly ViewSection[];
};

/** The view of a tool that declares none: the output as one `text` section named `result`. */
export const DEFAULT_TOOL_VIEW: ToolView = {
  sections: [{ id: "result", type: "text" }],
};

/** JSON Schema object for a tool's arguments, as the model sees it. */
export type JsonSchemaObject = {
  /** Always `"object"`. */
  type: "object";
  /** Schema of each argument by name. */
  properties?: Record<string, unknown>;
  /** Names of the arguments the model must give. */
  required?: readonly string[];
  /** `false` rejects unknown arguments. */
  additionalProperties?: boolean;
  /** Any other JSON Schema keyword. */
  [key: string]: unknown;
};

/** Members every direct tool has, whether bound to a method or with its own implementation. */
type ToolBase = {
  /** Unique across core and extension tools; lower-case letter first, then lower-case letters, digits or `_`, at most 64 characters. Prefix it with the extension id. */
  name: string;
  /** Shown on the Tools page; defaults to the name. */
  label?: string;
  /** Agent-facing description, sent with every request: at most 800 characters for installed extensions. Say what the tool does and when to use it. */
  description: string;
  /** Arguments of the tool. */
  parameters: JsonSchemaObject;
  /** How the transcript shows the call; `DEFAULT_TOOL_VIEW` when absent. */
  view?: ToolView;
  /** Boolean setting of the extension that switches this tool, in addition to the extension. */
  enabledBy?: string;
  /** The tool is offered only while this holds. */
  requires?: Requires;
  /** Extra checks the declaration cannot express. Hook: written as `true` in the manifest. */
  availability?: (
    ctx: ExtensionContext,
  ) => Promise<Availability> | Availability;
};

/** A tool bound to a namespace method (`web.search`): same parse → authorize → run. Use it when scripts and the model should share one implementation. */
export type MethodToolDefinition = ToolBase & {
  /** `<namespace>.<method>`. The method receives the tool's arguments object as its single argument. */
  method: string;
};

/** A tool with its own implementation. Use it when no script needs the operation. */
export type OwnToolDefinition<Input = any, Output = unknown> = ToolBase & {
  /** The most the tool can do; see `MethodDefinition.risk`. */
  risk: Risk;
  /** Validates the model's arguments object and returns the typed input; throws `ExtensionError("BAD_REQUEST", …)` on bad input. Synchronous and pure. */
  parse(args: Record<string, unknown>): Input;
  /** What the call is authorized as; see `MethodDefinition.authorize`. */
  authorize?(input: Input): AuthorizeResult;
  /** Does the work and returns plain data. */
  run(input: Input, ctx: ExtensionContext): Promise<Output> | Output;
  /**
   * Splits the output into what the agent reads (`text`) and what each view
   * section renders (`sections`, by section id). Without it, or without
   * `sections`, both are the output (the first section gets it). `details`
   * adds fields to the result's details; the agent projection of a tool with a
   * `links` section reads `query` and `answer` from them (a header above the results).
   */
  present?(output: Output): {
    /** What the agent reads. */
    text: string;
    /** Values of the view sections, by section id. */
    sections?: Record<string, unknown>;
    /** Extra result details for a `links` section's header. */
    details?: {
      /** The search query, shown above the results. */
      query?: string;
      /** A direct answer, shown above the results. */
      answer?: string;
    };
  };
};

/** A direct tool: the model calls it by name without writing a script. */
export type ToolDefinition = MethodToolDefinition | OwnToolDefinition;

/** Whether the tool is bound to a namespace method. */
export function isMethodTool(
  tool: ToolDefinition,
): tool is MethodToolDefinition {
  return "method" in tool;
}

/** A host capability an extension may use: image generation or image explanation. Declare it in `permissions.capabilities`. */
export type Capability = "models.image" | "models.vision";

/** What the extension may reach. The user sees it as one line per grant before allowing the extension. */
export type ExtensionPermissions = {
  /**
   * Origins `ctx.http` may reach: URL origins with `*` for one host label
   * (`https://*.atlassian.net`), `{account.<field>}` templates for the
   * selected account's fields and `{settings.<key>}` for a setting of the
   * extension. The entry `*` alone means any public `http(s)` origin (the host's
   * SSRF guard still applies; shown to the user as broad access). Absent: no network.
   * List each origin by name; use `*` only for a tool that must reach arbitrary sites.
   */
  network?: string[];
  /** Host capabilities: `models.image` → `ctx.models.image`, `models.vision` → `ctx.models.vision`. */
  capabilities?: Capability[];
};

/** How a file preview edits its file. */
export type PreviewEditMode = "source" | "custom" | "none";

/** A rendered view of a file type, shown in the file's tab. A frame: a Svelte component built by `nerve-ext build`. */
export type PreviewContribution = {
  /** Kebab-case (`csv-table`), unique among the extension's previews, at most 64 characters. */
  id: string;
  /** Name shown to the user (1–64 characters). */
  label: string;
  /** Which files it opens. */
  match: {
    /** Lower-case file extensions with the dot (`.csv`, `.tar.gz`); 1–32 entries. */
    extensions: readonly string[];
  };
  /** Source path of the frame's entry (`src/ui/csv-table.svelte`); `nerve-ext build` compiles it. */
  entry: string;
  /**
   * `"source"`: Nerve's source editor edits the file and the preview re-renders from the saved
   * file; `"custom"`: the frame edits and writes through `host.file.write` (shown to the user as
   * broad access, so use it only when the format needs a real editor); `"none"`: no edit toggle.
   * Default: `"none"` when every matched extension is a known binary format (images, archives,
   * office files, …), else `"source"`.
   */
  edit?: PreviewEditMode;
};

/** A tab pane with fully custom content, not bound to a file. A frame. */
export type PageContribution = {
  /** Kebab-case, unique among the extension's pages, at most 64 characters. Pass it to `host.openPage`. */
  id: string;
  /** Tab title and menu entry (1–64 characters). */
  label: string;
  /** A lucide icon name in kebab-case (`layout-dashboard`, `table`); an unknown name shows a puzzle piece. */
  icon: string;
  /** List the page in the new-tab menu (the chevron next to +). Default: true. */
  newMenu?: boolean;
  /** Source path of the frame's entry (`src/ui/overview.svelte`). */
  entry: string;
};

/** A dock panel like Files or Git. A frame. */
export type PanelContribution = {
  /** Kebab-case, unique among the extension's panels, at most 64 characters. */
  id: string;
  /** Panel title (1–64 characters). */
  label: string;
  /** A lucide icon name in kebab-case (`list-checks`); an unknown name shows a puzzle piece. */
  icon: string;
  /** Source path of the frame's entry. */
  entry: string;
};

/** A colour theme: token values in a JSON file. */
export type ThemeContribution = {
  /** Kebab-case, unique among the extension's themes, at most 64 characters; equals `id` in the theme file. */
  id: string;
  /** Name in Settings → Theme (1–64 characters); equals `label` in the theme file. */
  label: string;
  /** Source path of the theme file (`themes/solarized-dark.json`); its shape is the theme file schema. */
  file: string;
};

/** UI contributions: at most 16 of each kind. Previews, pages and panels run in sandboxed frames; themes are data. Only user extensions contribute themes (a project extension's themes are ignored). */
export type ExtensionUi = {
  /** File-type previews. */
  previews?: readonly PreviewContribution[];
  /** Tab panes. */
  pages?: readonly PageContribution[];
  /** Dock panels. */
  panels?: readonly PanelContribution[];
  /** Colour themes. */
  themes?: readonly ThemeContribution[];
};

/**
 * An extension, as `src/extension.ts` default-exports it (create it with `defineExtension`).
 * `nerve-ext build` writes the plain-data part to `dist/manifest.json` (hooks become `true`) and
 * the code to `dist/backend.js`. Installed (user and project) extensions may not set `prelude`
 * or `settings.migrations`.
 */
export type ExtensionDefinition = {
  /** Stable, kebab-case; settings, accounts and operations are keyed by it. Equals the folder name; lower-case letters, digits and single hyphens, starts with a letter, at most 64 characters. */
  id: string;
  /** Name on the Extensions page. */
  name: string;
  /** One line for the Extensions page. */
  description: string;
  /**
   * The extension's mark: a built-in lucide icon name (`blocks`, `eye`, `globe`, `image-plus`,
   * `layers`, `workflow`) or the path of an SVG file in the extension's folder ending in `.svg`
   * (`icon.svg`; at most 16 KB, square `viewBox`, no scripts or external references).
   * The host reads and checks it at registry creation and fails loudly on a bad value.
   * Pages and panels name their own `icon`, from all lucide names.
   */
  icon: string;
  /** Default of the implicit `enabled` switch. Use `false` for anything that reaches the network or an account. */
  enabledByDefault: boolean;
  /** The extension's settings schema and version. */
  settings: ExtensionSettings;
  /** Account kinds this extension defines, by kind. Kinds are unique across extensions. */
  accounts?: Readonly<Record<string, AccountKind>>;
  /** Network origins and host capabilities the extension may use. Absent: none. */
  permissions?: ExtensionPermissions;
  /** `quick_script` namespaces; see `defineNamespace`. */
  namespaces: readonly NamespaceDefinition<any>[];
  /** Direct tools; see `defineTool`. */
  tools?: readonly ToolDefinition[];
  /** Pure sandbox-side helper source (storage builders), evaluated after the SDK prelude; no host access. Not allowed in installed extensions. */
  prelude?: string;
  /** UI contributions. The build compiles them; the manifest carries the built paths. */
  ui?: ExtensionUi;
  /** Numbers (typically byte limits) filled into `{{limit:<name>}}` placeholders of docs and rules. */
  limits?: Readonly<Record<string, number>>;
};
