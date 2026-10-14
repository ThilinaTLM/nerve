import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  win32,
} from "node:path";
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";
import {
  htmlPreviewCreateRequestSchema,
  type HtmlPreviewApproval,
  type HtmlPreviewCreateResponse,
} from "@nervekit/contracts/filesystem";
import { ApplicationError } from "../../core/application-error.js";

const IDLE_MS = 15 * 60 * 1_000;
const MAX_ASSET_BYTES = 10 * 1_024 * 1_024;
const mimeTypes: Record<string, string> = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
type Session = {
  projectId: string;
  directory: string;
  root: string;
  path: string;
  html: string;
  approvals: HtmlPreviewApproval[];
  accessed: number;
};
function invalid(message: string): never {
  throw new ApplicationError(400, "INVALID_PREVIEW", message);
}
function missing(): never {
  throw new ApplicationError(
    404,
    "PREVIEW_NOT_FOUND",
    "Preview resource unavailable.",
  );
}
function projectPath(path: string): string {
  if (
    !path ||
    path.includes("\0") ||
    path.includes("\\") ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    /^[a-z]:/i.test(path)
  )
    invalid("Expected a project-relative path.");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      if (!parts.length) invalid("Path escapes the project.");
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  if (!parts.length) invalid("Expected a file path.");
  return parts.join("/");
}
function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel !== ".." &&
    !rel.startsWith("../") &&
    !rel.startsWith("..\\") &&
    !isAbsolute(rel)
  );
}

async function openProjectFile(root: string, path: string, mime?: string) {
  const requested = resolve(root, path);
  const target = await realpath(requested);
  if (
    !contained(root, target) ||
    (mime && mimeTypes[extname(target).toLowerCase()] !== mime)
  )
    missing();
  const file = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    // Portable best-effort TOCTOU hardening; Node does not expose directory-relative openat.
    const canonical = await realpath(requested);
    if (
      canonical !== target ||
      !contained(root, canonical) ||
      (mime && mimeTypes[extname(canonical).toLowerCase()] !== mime)
    )
      missing();
    const [opened, current] = await Promise.all([file.stat(), stat(canonical)]);
    if (
      !opened.isFile() ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino
    )
      missing();
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}

const bootstrap = `(() => {
  addEventListener('securitypolicyviolation', (event) => {
    const category = ({'script-src':'script','script-src-elem':'script','style-src':'style','style-src-elem':'style','img-src':'image','font-src':'font'})[event.effectiveDirective];
    if (category && /^https?:\\/\\//.test(event.blockedURI)) parent.postMessage({type:'nerve:html-preview-resource', category, url:event.blockedURI}, '*');
  });
  addEventListener('click', (event) => { if (event.composedPath().some(node => node?.localName === 'a' || node?.localName === 'area')) event.preventDefault(); }, true);
})();`;

function prepareDocument(text: string, base: string): string {
  const doc = parse(text);
  const clean = (parent: DefaultTreeAdapterMap["parentNode"]) => {
    parent.childNodes = parent.childNodes.filter((node) => {
      if (!("tagName" in node)) return true;
      if (node.tagName === "base") return false;
      if (
        node.tagName === "meta" &&
        node.attrs.some(
          (attr) =>
            attr.name === "http-equiv" &&
            attr.value.toLowerCase().trim() === "refresh",
        )
      )
        return false;
      if (node.tagName === "a" || node.tagName === "area")
        node.attrs = node.attrs.filter(
          (attr) => !["href", "target", "download", "ping"].includes(attr.name),
        );
      clean(node);
      if (node.tagName === "template" && "content" in node) clean(node.content);
      return true;
    });
  };
  clean(doc);
  const html = doc.childNodes.find(
    (node) => "tagName" in node && node.tagName === "html",
  ) as DefaultTreeAdapterMap["element"];
  const head = html.childNodes.find(
    (node) => "tagName" in node && node.tagName === "head",
  ) as DefaultTreeAdapterMap["element"];
  const injected = parseFragment(
    `<base href="${base}"><script>${bootstrap}</script>`,
  ).childNodes;
  for (const node of injected) node.parentNode = head;
  head.childNodes.unshift(...injected);
  return serialize(doc);
}

export class HtmlPreviewService {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly getDirectory: (projectId: string) => string,
    private readonly now: () => number = Date.now,
  ) {}

  private expire(): void {
    for (const [id, session] of this.sessions)
      if (this.now() - session.accessed >= IDLE_MS) this.sessions.delete(id);
  }

  async create(
    input: unknown,
    serverOrigin: string,
  ): Promise<HtmlPreviewCreateResponse> {
    const parsed = htmlPreviewCreateRequestSchema.safeParse(input);
    if (!parsed.success) invalid("Invalid HTML preview request.");
    const request = parsed.data;
    if (Buffer.byteLength(request.text) > 1_024 * 1_024)
      invalid("Preview draft exceeds 1 MiB.");
    const path = projectPath(request.path);
    if (!/\.html?$/i.test(path)) invalid("Expected an HTML file.");
    const approvals = request.approvals ?? [];
    if (approvals.some((approval) => approval.origin === serverOrigin))
      invalid("The daemon origin cannot be approved.");
    const directory = this.getDirectory(request.projectId);
    const root = await realpath(directory);
    const file = await openProjectFile(root, path);
    await file.close();
    this.expire();
    if (this.sessions.size >= 64)
      throw new ApplicationError(
        429,
        "PREVIEW_LIMIT",
        "Too many active previews.",
      );
    const id = randomBytes(32).toString("hex");
    const documentDirectory = dirname(path).replaceAll("\\", "/");
    const base = `/html-preview/${id}/assets/${documentDirectory === "." ? "" : documentDirectory.split("/").map(encodeURIComponent).join("/") + "/"}`;
    const html = prepareDocument(request.text, base);
    this.sessions.set(id, {
      projectId: request.projectId,
      directory,
      root,
      path,
      html,
      approvals,
      accessed: this.now(),
    });
    return { id, url: `/html-preview/${id}/document` };
  }

  revoke(id: string): void {
    this.sessions.delete(id);
  }

  async resource(
    id: string,
    assetPath: string | undefined,
    origin: string,
    head = false,
  ): Promise<Response> {
    this.expire();
    const session = this.sessions.get(id);
    if (!session) missing();
    try {
      if (
        this.getDirectory(session.projectId) !== session.directory ||
        (await realpath(session.directory)) !== session.root
      ) {
        this.revoke(id);
        missing();
      }
    } catch {
      this.revoke(id);
      missing();
    }
    session.accessed = this.now();
    const prefix = `${origin}/html-preview/${id}/assets/`;
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy":
        "default-src 'none'; sandbox; style-src 'unsafe-inline'; frame-ancestors 'none'",
    };
    if (assetPath === undefined) {
      const sources = (category: HtmlPreviewApproval["category"]) =>
        [
          prefix,
          ...session.approvals
            .filter((a) => a.category === category)
            .map((a) => a.origin),
        ].join(" ");
      headers["Content-Type"] = "text/html; charset=utf-8";
      headers["Content-Security-Policy"] =
        `default-src 'none'; sandbox allow-scripts; base-uri ${prefix}; script-src 'unsafe-inline' ${sources("script")}; style-src 'unsafe-inline' ${sources("style")}; img-src data: blob: ${sources("image")}; font-src data: blob: ${sources("font")}; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'`;
      return new Response(head ? null : session.html, { headers });
    }
    let path: string;
    try {
      path = projectPath(decodeURIComponent(assetPath));
    } catch {
      missing();
    }
    const mime = mimeTypes[extname(path).toLowerCase()];
    if (!mime) missing();
    // Verify the opened canonical target, then bound reads even if the file grows concurrently.
    const file = await openProjectFile(session.root, path, mime).catch(() =>
      missing(),
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) missing();
      headers["Content-Type"] = mime;
      if (head) return new Response(null, { headers });
      const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_ASSET_BYTES + 1));
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await file.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead,
        );
        if (!result.bytesRead) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead > MAX_ASSET_BYTES) missing();
      return new Response(new Uint8Array(buffer.subarray(0, bytesRead)), {
        headers,
      });
    } finally {
      await file.close();
    }
  }
}
