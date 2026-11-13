# Extension manifest and contributions

Part of [Extensions](README.md).

## Manifest

Every extension, built-in or not, is described by a manifest. The schema lives in `packages/contracts`, so installed extensions depend on contracts only. A built-in extension's manifest sits next to its code.

```ts
type ExtensionManifest = {
  id: string; // "atlassian"; kebab-case, unique, stable (settings are keyed by it)
  name: string; // "Atlassian"
  description: string; // one line for the Extensions page
  source: "builtin"; // "installed" comes with installable extensions
  icon: string; // lucide icon name
  accounts?: AccountKind[]; // account kinds this extension defines (settings.md#accounts)
  settings?: SettingsSchema; // see settings.md
  contributes: {
    sdk?: SdkNamespace[]; // quick_script namespaces
    tools?: string[]; // direct tool names
    skills?: string[]; // skill directories shipped with the extension
  }; // later: mcpServers (mcp.md), themes
};
```

- **Availability is computed, not declared.** The host evaluates it from the resolved settings: the extension is enabled, and every account field a contribution needs points at an existing account with a saved credential. The result is `available`, or `unavailable` with a reason and a fix, and the agent and the Extensions page show the same text.
- **A contribution can depend on a setting.** `enabledBy: "jira"` ties the `jira` namespace to the Atlassian extension's `jira` switch, so one extension can expose several independently switchable parts.
- **Ids are stable.** Renaming an id is a settings migration, because user, project and conversation settings are keyed by it.

### SDK namespace contribution

```ts
type SdkNamespace = {
  id: string; // global in the sandbox: "jira", "mcp.github"
  enabledBy?: string; // boolean setting key of the extension
  summary: string; // one line in the quick_script description
  rules?: string[]; // at most 3 short lines, added only when active
  methods: SdkMethod[]; // today's method tables, plus operation and target extraction
  types: string; // shared declarations for sdk.describe
  docs: { id: string; whenToRead: string; file: string }[]; // sdk.docs topics
};
```

The registry replaces the hard-coded lists in `description.ts`, `sdk.ts`, `runtime-prelude.ts` (guarded globals), `scoped-turn-resources.ts` and `brokerable()`. The [namespace design rules](../../architecture/code-mode.md#namespace-design-rules) apply to every namespace. MCP servers will register namespaces in the same registry ([mcp.md](mcp.md)).

`methods` keeps today's method tables, with `authorize` returning an operation instead of a direct tool ([permissions.md](permissions.md#nested-check)). Until step 4 the registry adapter still supplies the direct-tool identity, so steps 1–3 do not touch policy.

## Built-in extensions

| Extension        | Settings                                                                                         | Contributes                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Atlassian        | Atlassian account, Jira switch, Confluence switch                                                | `atlassian`, `jira`, `confluence` and `storage` namespaces; `project-knowledge` doc |
| Web              | Tavily account (search only)                                                                     | `web_fetch` and `web_search` tools; `web` namespace                                 |
| Image generation | Backend, model and default options (today's `imageGeneration` union, `provider: "openai-codex"`) | `imagegen` namespace                                                                |
| Diagrams         | Kroki server URL                                                                                 | `diagram` namespace                                                                 |

`files`, `image`, the document libraries (`XLSX`, `Papa`, `docx`, …) and `sdk` are part of the `quick_script` runtime, not extensions. They need no settings and are always present.

`web.search` stays in the SDK even though the direct tool exists: it costs nothing in the description and lets one script search, fetch the top results, and print only what matters.

### `imagegen`

`image` stays the transform chain over existing files, and `imagegen` creates new images. The name describes the capability, not the vendor, so more backends (Gemini, later others) plug in without renaming:

```ts
const hero = await imagegen.generate({
  prompt: "Isometric server rack, flat colours",
  size: "1536x1024",
  name: "hero.png",
});
await image(hero).resize({ width: 760 }).save("hero-760.png");
```

- A new backend is a new member of the settings union, and `sdk.describe("imagegen")` shows the configured backend and its options.
- **Options shared by all backends are typed:** `prompt`, `size`, `name`, and `inputs` (reference images as file handles). Backend-only options go in `backendOptions`, which `describe` documents per backend.
- Results are artifacts, like `diagram.render`, so they chain into `image`, attachments and page bodies.
- Risk is network: the call spends credit at the vendor but changes no user data.

## Docs layout

```text
packages/quick-script/src/
  runtime/              sandbox, prelude, scanner, executor, result; files, image, libraries, sdk
  extensions/
    atlassian/          manifest.ts, jira/, confluence/, shared/; docs/{jira-workflows,jira-raw,confluence-writing,storage,confluence-raw,project-knowledge}.md
    web/
    imagegen/
    diagram/
  registry.ts
```

- **Signatures exist only in method tables.** Markdown topics never repeat them, and the existing test that checks method names in Markdown carries over.
- **Each fact has one owner topic,** and other topics link to it with `sdk.docs("runtime/images")`. Image rules currently stated in both `files.md` and `confluence-writing.md` move to one topic.
- **Limits come from code.** Topics write `{{limit:files.read}}` and the build fills in the constant, so 20 MB, 100 MB and 128 KiB cannot drift.
- **A CI test** renders every extension's docs and `describe` output, compiles the declarations together, and fails on links to missing topics.

### `packages/skills` keeps only skills

- **Delete `guides/`.** `guides/jira` and `guides/confluence` go with the direct tools; `guides/quick-script` becomes extension and runtime docs.
- `builtinSkillFilePath` searches only `builtin/`, and `{{skill:…}}` resolves only catalog skills. The system prompt's `formatToolGuides` goes away.
- **Rule:** content that helps with a kind of task and appears in `available_skills` is a skill. Content that explains one tool or namespace lives with it and is reached through it (the tool description, `sdk.docs`, or errors). An extension that wants to teach a task ships a real skill through `contributes.skills`.
- The `project-knowledge` topic points at `skill-creator`, which remains the single owner of skill format rules.

## Package

A new package, `@nervekit/quick-script`, holds the runtime, registry, built-in extensions and their docs. It sits in the engine layer beside `tools`:

- It depends on `contracts`, `native` (sandbox, image) and the integration clients.
- `tools` registers the single `quick_script` definition from it.
- The Jira and Confluence clients move into the Atlassian extension once the direct tools are deleted, since nothing else uses them.
- `ALLOWED_INTERNAL_DEPENDENCIES` gets the new edges.

The registry may later move to its own package when MCP servers or installed extensions need it outside quick-script. Until then it stays with its only consumer.

**Contracts:** the manifest, settings schema and availability types go in `packages/contracts` (`domains/extensions/`), because the server, the app and later installed extensions all read them.

## Installable extensions (later)

Two tiers with different trust are expected: **sandbox-only** extensions (pure JS for the sandbox, skills, themes; no host authority) and **host** extensions (trusted daemon code implementing SDK methods through the same nested authorization). Packaging, installation, updates and signing are a separate proposal. This one guarantees only that the contract does not assume an extension is compiled in.
