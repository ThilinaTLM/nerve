import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { sandbox } from "@nervekit/native";
import { resolveExtensions } from "@nervekit/contracts/extensions";
import { createHostExtensionCatalog } from "../../../src/core-host/host-tools.js";
import { overrideTrustGate } from "../../../src/core-host/extension-catalog/trust-gate.js";
import { ExtensionUiService } from "../../../src/core-host/extension-ui/extension-ui-service.js";
import { ExtensionUiError } from "../../../src/core-host/extension-ui/extension-ui-error.js";
import { createExtensionFrameRoutes } from "../../../src/adapters/http/routes/extension-frame-routes.js";
import { writeExtension } from "./fixtures.js";

const skip = !sandbox.isPersistentAvailable();
let root = "";
let counter = 0;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "extension-ui-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

const ui = {
  previews: [
    { id: "table", extensions: [".csv"], edit: "custom" as const },
    { id: "plain", extensions: [".csv", ".tsv"], edit: "source" as const },
  ],
  pages: ["explorer"],
  panels: ["summary"],
};

/** A home with a user extension, two projects, a project file tree with an escaping symlink, and the UI service over them. */
async function world(
  options: {
    trusted?: boolean;
    enabled?: boolean;
    themes?: string[];
    lowContrast?: string[];
  } = {},
) {
  const base = join(root, `w${counter++}`);
  const home = join(base, "home");
  const userRoot = join(home, "agent", "extensions");
  await mkdir(userRoot, { recursive: true });
  await writeExtension(userRoot, {
    id: "ui-probe",
    ui,
    themes: options.themes ?? ["night.json"],
    ...(options.lowContrast ? { lowContrastThemes: options.lowContrast } : {}),
  });
  const projects: Record<
    string,
    { id: string; name: string; directory: string }
  > = {};
  for (const id of ["p1", "p2"]) {
    const directory = join(base, id);
    await mkdir(join(directory, ".nerve", "extensions"), { recursive: true });
    projects[id] = { id, name: `Project ${id}`, directory };
  }
  const p1 = projects.p1!.directory;
  await writeFile(join(p1, "data.csv"), "a,b\n1,2\n");
  await writeFile(join(p1, "notes.txt"), "text");
  await writeFile(join(base, "secret.csv"), "secret");
  await symlink(join(base, "secret.csv"), join(p1, "link.csv"));
  const catalog = createHostExtensionCatalog({
    home,
    trustGate: overrideTrustGate((candidate) =>
      options.trusted === false && candidate.id === "ui-probe"
        ? "pending"
        : "trusted",
    ),
  });
  let enabled = options.enabled ?? true;
  const service = new ExtensionUiService({
    catalog,
    extensions: {
      resolve: async (context) =>
        resolveExtensions(
          catalog.settingsDefinitions(
            context.projectId
              ? projects[context.projectId]?.directory
              : undefined,
          ),
          [
            {
              layer: "user",
              entries: {
                "ui-probe": {
                  version: 1,
                  ...(enabled ? {} : { enabled: false }),
                },
              },
            },
          ],
        ),
    } as never,
    accounts: {
      get: async () => undefined,
      list: async () => [],
      secret: async () => undefined,
      hasSecret: async () => false,
    },
    project: (id) => projects[id],
  });
  await catalog.compose();
  await catalog.compose(p1);
  const assets = join(base, "assets");
  await mkdir(join(assets, "assets"), { recursive: true });
  await writeFile(join(assets, "base.css"), ":root{}");
  await writeFile(join(assets, "assets", "font.woff2"), "font");
  const app = createExtensionFrameRoutes({ extensionUi: service }, assets);
  return {
    base,
    home,
    p1,
    projects,
    catalog,
    service,
    app,
    setEnabled: (value: boolean) => void (enabled = value),
    get: (path: string, init?: RequestInit) =>
      app.request(`http://daemon.test${path}`, init),
  };
}

const call = (
  w: Awaited<ReturnType<typeof world>>,
  method: string,
  contribution: { kind: "preview" | "page" | "panel"; id: string },
  params: unknown = {},
  extra: { filePath?: string; projectId?: string } = {},
) =>
  (w.service.bridge as (m: string, i: unknown) => Promise<unknown>).call(
    w.service,
    method,
    {
      projectId: extra.projectId ?? "p1",
      extensionId: "ui-probe",
      contribution,
      ...(extra.filePath !== undefined ? { filePath: extra.filePath } : {}),
      params,
    },
  );

const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof ExtensionUiError, String(error));
    assert.equal(error.bridgeCode, code, error.message);
    return true;
  });

const preview = { kind: "preview" as const, id: "table" };

void test(
  "contributions list frames of enabled, consented extensions with per-project URLs",
  { skip },
  async () => {
    const w = await world();
    const one = await w.service.contributions("p1");
    assert.equal(one.baseCssUrl, "/ext-frame/base.css");
    assert.deepEqual(
      one.previews.map((p) => [p.id, p.edit, p.match.extensions]),
      [
        ["table", "custom", [".csv"]],
        ["plain", "source", [".csv", ".tsv"]],
      ],
    );
    assert.deepEqual(
      one.pages.map((p) => [p.id, p.icon]),
      [["explorer", "table"]],
    );
    assert.deepEqual(
      one.panels.map((p) => p.id),
      ["summary"],
    );
    assert.match(
      one.previews[0]!.frameUrl,
      /^\/ext-frame\/[a-f0-9]{64}\/ui-probe\/table\/index\.html$/,
    );
    const two = await w.service.contributions("p2");
    assert.notEqual(
      one.previews[0]!.frameUrl.split("/")[2],
      two.previews[0]!.frameUrl.split("/")[2],
      "tokens differ per project",
    );
    assert.equal(
      one.previews[0]!.frameUrl,
      (await w.service.contributions("p1")).previews[0]!.frameUrl,
      "and are stable for a project",
    );
    w.setEnabled(false);
    assert.deepEqual((await w.service.contributions("p1")).previews, []);
    await rejects(w.service.contributions("nope"), "not_found");
  },
);

void test(
  "a pending extension contributes nothing and its frames are not served",
  { skip },
  async () => {
    const w = await world({ trusted: false });
    const contributions = await w.service.contributions("p1");
    assert.deepEqual(
      [contributions.previews, contributions.pages, contributions.panels],
      [[], [], []],
    );
    assert.deepEqual((await w.service.themes()).themes, []);
  },
);

void test(
  "frames are served with the strict CSP and refuse everything else",
  { skip },
  async () => {
    const w = await world();
    const url = (await w.service.contributions("p1")).previews[0]!.frameUrl;
    const response = await w.get(url);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /app\.js/);
    const policy = response.headers.get("content-security-policy")!;
    const folder = url.slice(0, -"index.html".length);
    for (const directive of [
      "default-src 'none'",
      "sandbox allow-scripts",
      `script-src http://daemon.test${folder}`,
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
      `worker-src http://daemon.test${folder} blob:`,
      "frame-ancestors 'self'",
    ])
      assert.ok(policy.includes(directive), `${directive} in ${policy}`);
    assert.doesNotMatch(
      policy,
      /unsafe-eval|'unsafe-inline'(?! *;?$)(?<!style-src-attr 'unsafe-inline')/,
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");

    const script = await w.get(`${folder}app.js`);
    assert.equal(script.headers.get("content-type"), "text/javascript");
    assert.equal(script.headers.get("access-control-allow-origin"), "*");
    assert.equal((await w.get(url, { method: "HEAD" })).status, 200);
    assert.equal((await w.get(url, { method: "POST" })).status, 405);
    // Default document.
    assert.equal((await w.get(folder)).status, 200);

    const token = folder.split("/")[2]!;
    for (const missing of [
      `${folder}missing.js`,
      `${folder}..%2f..%2fmanifest.json`,
      `/ext-frame/${"0".repeat(64)}/ui-probe/table/index.html`,
      `/ext-frame/${token}/other-ext/table/index.html`,
      `/ext-frame/${token}/ui-probe/unknown/index.html`,
      `/ext-frame/${token}/ui-probe/table/backend.js`,
      `/ext-frame/short/ui-probe/table/index.html`,
    ])
      assert.equal((await w.get(missing)).status, 404, missing);

    // A type the allowlist does not name, a symbolic link out of the folder.
    const dist = join(
      w.home,
      "agent",
      "extensions",
      "ui-probe",
      "dist",
      "ui",
      "table",
    );
    await writeFile(join(dist, "notes.txt"), "no");
    await writeFile(join(w.base, "outside.js"), "export {}");
    await symlink(join(w.base, "outside.js"), join(dist, "escape.js"));
    assert.equal((await w.get(`${folder}notes.txt`)).status, 404);
    assert.equal((await w.get(`${folder}escape.js`)).status, 404);

    // Shared assets: the base stylesheet and its fonts, nothing else.
    const css = await w.get("/ext-frame/base.css");
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("content-type"), "text/css");
    assert.equal(css.headers.get("access-control-allow-origin"), "*");
    const font = await w.get("/ext-frame/assets/font.woff2");
    assert.equal(font.status, 200);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.equal(font.headers.get("access-control-allow-origin"), "*");
    assert.equal(font.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await w.get("/ext-frame/assets/..%2fbase.css")).status, 404);
    assert.equal((await w.get("/ext-frame/assets/missing.woff2")).status, 404);
  },
);

void test(
  "a frame is gone when its extension is switched off",
  { skip },
  async () => {
    const w = await world();
    const url = (await w.service.contributions("p1")).panels[0]!.frameUrl;
    assert.equal((await w.get(url)).status, 200);
    w.setEnabled(false);
    assert.equal((await w.get(url)).status, 404);
  },
);

void test(
  "project extensions are served only to their own project",
  { skip },
  async () => {
    const w = await world();
    const projectRoot = join(w.projects.p2!.directory, ".nerve", "extensions");
    await writeExtension(projectRoot, {
      id: "only-p2",
      namespace: "probetwo",
      toolPrefix: "two",
      ui: { pages: ["board"] },
    });
    w.setEnabled(true);
    const resolveBoth = await w.service.contributions("p2");
    assert.deepEqual(
      resolveBoth.pages.map((p) => [p.extensionId, p.source]),
      [
        ["ui-probe", "user"],
        ["only-p2", "project"],
      ],
    );
    const own = resolveBoth.pages.find((p) => p.extensionId === "only-p2")!;
    assert.equal((await w.get(own.frameUrl)).status, 200);
    // The same extension and contribution under the other project's token.
    const otherToken = (
      await w.service.contributions("p1")
    ).pages[0]!.frameUrl.split("/")[2];
    assert.equal(
      (await w.get(`/ext-frame/${otherToken}/only-p2/board/index.html`)).status,
      404,
    );
    assert.deepEqual(
      (await w.service.contributions("p1")).pages.map((p) => p.extensionId),
      ["ui-probe"],
    );
  },
);

void test(
  "bridge methods follow the allowlist of the contribution kind and edit mode",
  { skip },
  async () => {
    const w = await world();
    const file = { filePath: "data.csv" };
    // Pages and panels have no file.
    await rejects(
      call(w, "file.info", { kind: "page", id: "explorer" }, {}, file),
      "not_allowed",
    );
    await rejects(
      call(w, "file.read", { kind: "panel", id: "summary" }, {}, file),
      "not_allowed",
    );
    // `file.write` needs edit: "custom", whatever the caller claims.
    await rejects(
      call(
        w,
        "file.write",
        { kind: "preview", id: "plain" },
        { content: "x", encoding: "utf8" },
        file,
      ),
      "not_allowed",
    );
    // The kind must be the declared one; an unknown id is not found.
    await rejects(
      call(w, "file.info", { kind: "page", id: "table" }, {}, file),
      "not_found",
    );
    await rejects(
      call(w, "file.info", { kind: "preview", id: "ghost" }, {}, file),
      "not_found",
    );
    // Parameters are validated again.
    await rejects(
      call(w, "file.read", preview, { length: 0 }, file),
      "invalid_request",
    );
    // A preview needs the file it is opened on, of a type it declares.
    await rejects(call(w, "file.info", preview, {}), "invalid_request");
    await rejects(
      call(w, "file.info", preview, {}, { filePath: "notes.txt" }),
      "not_allowed",
    );
    // Disabled extensions answer nothing.
    w.setEnabled(false);
    await rejects(call(w, "file.info", preview, {}, file), "not_found");
  },
);

void test(
  "file.info and file.read: project containment and ranges",
  { skip },
  async () => {
    const w = await world();
    const info = (await call(
      w,
      "file.info",
      preview,
      {},
      { filePath: "data.csv" },
    )) as Record<string, unknown>;
    assert.equal(info.path, "data.csv");
    assert.equal(info.name, "data.csv");
    assert.equal(info.extension, ".csv");
    assert.equal(info.size, 8);
    // An absolute path inside the project is the same file.
    const absolute = (await call(
      w,
      "file.info",
      preview,
      {},
      { filePath: join(w.p1, "data.csv") },
    )) as Record<string, unknown>;
    assert.equal(absolute.path, "data.csv");

    const head = (await call(
      w,
      "file.read",
      preview,
      { offset: 0, length: 3 },
      { filePath: "data.csv" },
    )) as {
      dataBase64: string;
      length: number;
      size: number;
      eof: boolean;
      offset: number;
    };
    assert.equal(Buffer.from(head.dataBase64, "base64").toString(), "a,b");
    assert.deepEqual(
      [head.offset, head.length, head.size, head.eof],
      [0, 3, 8, false],
    );
    const tail = (await call(
      w,
      "file.read",
      preview,
      { offset: 3 },
      { filePath: "data.csv" },
    )) as typeof head;
    assert.equal(Buffer.from(tail.dataBase64, "base64").toString(), "\n1,2\n");
    assert.equal(tail.eof, true);
    const past = (await call(
      w,
      "file.read",
      preview,
      { offset: 100 },
      { filePath: "data.csv" },
    )) as typeof head;
    assert.deepEqual([past.length, past.eof], [0, true]);

    for (const escape of [
      "../secret.csv",
      join(w.base, "secret.csv"),
      "link.csv",
      "missing.csv",
    ])
      await rejects(
        call(w, "file.read", preview, {}, { filePath: escape }),
        "not_found",
      );
  },
);

void test(
  "file.write is atomic, keeps the mode and stays on the tab's file",
  { skip },
  async () => {
    const w = await world();
    const path = join(w.p1, "data.csv");
    await chmod(path, 0o640);
    const written = await call(
      w,
      "file.write",
      preview,
      { content: "x,y\n9,9\n", encoding: "utf8" },
      { filePath: "data.csv" },
    );
    assert.deepEqual(written, { size: 8 });
    assert.equal(await readFile(path, "utf8"), "x,y\n9,9\n");
    assert.equal((await stat(path)).mode & 0o777, 0o640);
    await call(
      w,
      "file.write",
      preview,
      {
        content: Buffer.from([0, 1, 2]).toString("base64"),
        encoding: "base64",
      },
      { filePath: "data.csv" },
    );
    assert.deepEqual([...(await readFile(path))], [0, 1, 2]);
    // Outside the project, through a link, or too large: refused and untouched.
    await rejects(
      call(
        w,
        "file.write",
        preview,
        { content: "x", encoding: "utf8" },
        { filePath: "link.csv" },
      ),
      "not_found",
    );
    assert.equal(await readFile(join(w.base, "secret.csv"), "utf8"), "secret");
    await rejects(
      call(
        w,
        "file.write",
        preview,
        { content: "x", encoding: "utf8" },
        { filePath: "../secret.csv" },
      ),
      "not_found",
    );
    await rejects(
      call(
        w,
        "file.write",
        preview,
        { content: "x".repeat(5 * 1024 * 1024 + 1), encoding: "utf8" },
        { filePath: "data.csv" },
      ),
      "too_large",
    );
    // Only files that exist: a preview edits the file of its tab, it does not create files.
    await rejects(
      call(
        w,
        "file.write",
        preview,
        { content: "x", encoding: "utf8" },
        { filePath: "new.csv" },
      ),
      "not_found",
    );
  },
);

void test(
  "settings.get and project.info answer for the open project",
  { skip },
  async () => {
    const w = await world();
    assert.deepEqual(
      await call(w, "settings.get", { kind: "panel", id: "summary" }),
      { values: { greeting: "hi" } },
    );
    assert.deepEqual(
      await call(w, "project.info", { kind: "page", id: "explorer" }),
      {
        id: "p1",
        name: "Project p1",
        directory: w.p1,
      },
    );
  },
);

void test(
  "call runs the extension's own backend method in the sandbox, bound to the project",
  { skip },
  async () => {
    const w = await world();
    const page = { kind: "page" as const, id: "explorer" };
    assert.deepEqual(
      await call(w, "call", page, {
        method: "probe.greet",
        args: { name: "Ada" },
      }),
      {
        value: { message: "hi Ada" },
      },
    );
    // From a panel and a preview as well.
    assert.deepEqual(
      await call(
        w,
        "call",
        { kind: "panel", id: "summary" },
        { method: "probe.echo", args: "x" },
      ),
      { value: { greeting: "hi", text: "x" } },
    );
    // The method must exist and belong to the extension.
    await rejects(
      call(w, "call", page, { method: "probe.missing" }),
      "not_found",
    );
    await rejects(
      call(w, "call", page, { method: "files.read", args: "x" }),
      "not_found",
    );
    await rejects(call(w, "call", page, { method: "nodot" }), "not_found");
    // The backend's own error is reported as backend_error with its message.
    await assert.rejects(
      call(w, "call", page, { method: "probe.greet", args: {} }),
      (error) =>
        error instanceof ExtensionUiError &&
        error.bridgeCode === "backend_error" &&
        /greet needs a name/.test(error.message),
    );
    // ctx rules: a declared read outside the open project is refused.
    assert.deepEqual(
      await call(w, "call", page, { method: "probe.peek", args: "data.csv" }),
      { value: { path: "data.csv" } },
    );
    await rejects(
      call(w, "call", page, { method: "probe.peek", args: "../secret.csv" }),
      "failed",
    );
    await rejects(
      call(w, "call", page, {
        method: "probe.peek",
        args: join(w.base, "secret.csv"),
      }),
      "failed",
    );
    await rejects(
      call(w, "call", page, { method: "probe.peek", args: "link.csv" }),
      "failed",
    );
    // Arguments over the limit never reach the backend.
    await rejects(
      call(w, "call", page, {
        method: "probe.greet",
        args: { name: "x".repeat(1024 * 1024 + 1) },
      }),
      "invalid_request",
    );
  },
);

void test(
  "themes: valid ones are offered with resolved tokens; a theme that fails a readability rule becomes a diagnostic",
  { skip },
  async () => {
    const w = await world({
      themes: ["night.json", "low.json"],
      lowContrast: ["low.json"],
    });
    const { themes } = await w.service.themes();
    assert.deepEqual(
      themes.map((theme) => theme.id),
      ["ext:ui-probe/night"],
    );
    const [night] = themes;
    assert.equal(night!.kind, "dark");
    assert.equal(night!.tokens.background, "oklch(0.264 0.018 80)");
    assert.match(night!.tokensCss, /^--background:oklch\(0\.264 0\.018 80\);/);
    const entry = (await w.catalog.entries()).find((e) => e.id === "ui-probe")!;
    assert.equal(entry.state, "enabled");
    assert.ok(
      entry.diagnostics.some(
        (d) =>
          d.level === "warning" &&
          /theme 'low' is not offered: foreground on background has contrast/.test(
            d.message,
          ),
      ),
      JSON.stringify(entry.diagnostics),
    );
    // The switch hides themes too.
    w.setEnabled(false);
    assert.deepEqual((await w.service.themes()).themes, []);
  },
);

void test(
  "a malformed theme file is a diagnostic, not a failure of the extension",
  { skip },
  async () => {
    const w = await world();
    const file = join(
      w.home,
      "agent",
      "extensions",
      "ui-probe",
      "dist",
      "themes",
      "night.json",
    );
    await writeFile(
      file,
      JSON.stringify({
        id: "night",
        label: "n",
        kind: "dark",
        tokens: { background: "url(x)" },
      }),
    );
    await w.catalog.reload();
    const entry = (await w.catalog.entries()).find((e) => e.id === "ui-probe")!;
    assert.equal(entry.state, "enabled");
    assert.ok(
      entry.diagnostics.some((d) =>
        /theme 'night' is not offered/.test(d.message),
      ),
    );
    assert.deepEqual((await w.service.themes()).themes, []);
  },
);
