import { Hono } from "hono";
import { resolve } from "node:path";
import { findPackageRoot } from "../../../infrastructure/package-root.js";
import {
  baseCssUrl,
  frameUrlPrefix,
  type ExtensionUiService,
} from "../../../core-host/extension-ui/extension-ui-service.js";
import {
  frameMimeTypes,
  framePath,
  readContainedFile,
  type FrameFile,
} from "../../../core-host/extension-ui/frame-files.js";

/** `dist/ext-frame/` of this build: the base stylesheet and its fonts (`scripts/build/build-extension-frame-css.ts`). */
export function resolveFrameAssetsPath(moduleUrl: string): string {
  return resolve(
    process.env.NERVE_EXT_FRAME_DIST?.trim() ||
      resolve(findPackageRoot(moduleUrl), "dist", "ext-frame"),
  );
}

const assetTypes = {
  ".css": frameMimeTypes[".css"],
  ".woff": frameMimeTypes[".woff"],
  ".woff2": frameMimeTypes[".woff2"],
};

/**
 * The CSP of every frame response. Scripts, styles, images and fonts come from the frame's own
 * folder (plus the shared base stylesheet and its fonts); there is no network, no nested frame,
 * no form and no plugin; workers may come from the folder or a `blob:` (pdf.js and similar). The
 * `sandbox` directive keeps a frame opened outside the app's iframe opaque as well, and only the
 * app's own origin may embed it.
 */
export function frameContentSecurityPolicy(
  origin: string,
  folder: string,
): string {
  const own = `${origin}${folder}`;
  const base = `${origin}${baseCssUrl}`;
  const fonts = `${origin}${frameUrlPrefix}/assets/`;
  return [
    "default-src 'none'",
    "sandbox allow-scripts",
    `base-uri ${own}`,
    `script-src ${own}`,
    `style-src ${own} ${base}`,
    // `style="…"` attributes and CSSOM changes of components; nothing a style can load leaves the allowlists.
    "style-src-attr 'unsafe-inline'",
    // `data:` and `blob:` let a frame show what it read through the bridge.
    `img-src ${own} data: blob:`,
    `font-src ${own} ${fonts} data:`,
    "media-src blob: data:",
    `worker-src ${own} blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

function headersFor(file: FrameFile, extra: Record<string, string>): Headers {
  return new Headers({
    "Content-Type": file.mime,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // The sandboxed frame has an opaque origin: module scripts, fonts and other CORS-mode loads need this.
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    ...extra,
  });
}

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/**
 * `/ext-frame/…`, served without the API credential like `/html-preview/…`: the URL's token
 * is the capability, a frame's own requests cannot carry a header, and the files are the
 * extension's own `dist/` output. Which extensions are served, and where, is the service's decision.
 */
export function createExtensionFrameRoutes(
  state: { extensionUi: ExtensionUiService },
  assetsPath: string = resolveFrameAssetsPath(import.meta.url),
): Hono {
  const app = new Hono();
  app.all(`${frameUrlPrefix}/*`, async (c) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD")
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
      });
    const url = new URL(c.req.url);
    const head = c.req.method === "HEAD";
    const respond = (
      file: FrameFile | undefined,
      extra: Record<string, string>,
    ) =>
      file
        ? new Response(head ? null : file.body, {
            headers: headersFor(file, extra),
          })
        : notFound();

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    const shared = /^\/ext-frame\/(base\.css|assets\/[^/]+)$/.exec(pathname);
    if (shared) {
      const path = framePath(shared[1]);
      return respond(
        path
          ? await readContainedFile(assetsPath, path, { allowed: assetTypes })
          : undefined,
        {
          "Cache-Control": shared[1].startsWith("assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        },
      );
    }
    const match = /^\/ext-frame\/([a-f0-9]{64})\/([^/]+)\/([^/]+)\/(.*)$/.exec(
      pathname,
    );
    if (!match) return notFound();
    const [, token, extensionId, contribution, rest] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    const file = await state.extensionUi.frameFile(
      token,
      extensionId,
      contribution,
      rest,
    );
    return respond(file, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": frameContentSecurityPolicy(
        url.origin,
        `${frameUrlPrefix}/${token}/${extensionId}/${contribution}/`,
      ),
    });
  });
  return app;
}
