import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  dirname,
  extname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKDOWN_EXTENSION = /\.mdx?$/i;
const EXTERNAL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

function walk(root, predicate = () => true) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, predicate));
    else if (predicate(path)) files.push(path);
  }
  return files;
}

function routeForFile(contentRoot, file) {
  const source = relative(contentRoot, file).split(sep).join("/");
  const withoutExtension = source.replace(MARKDOWN_EXTENSION, "");
  const route = withoutExtension.endsWith("/index")
    ? withoutExtension.slice(0, -"/index".length)
    : withoutExtension;
  return `/${route}/`.replace(/\/+/g, "/");
}

function removeFencedCode(source) {
  return source.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
}

function frontmatter(source) {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*?)\s*$/);
    if (field) result[field[1]] = field[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return result;
}

function slugifyHeading(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/&[a-z\d#]+;/gi, "")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function headings(source) {
  const result = new Set();
  const counts = new Map();
  for (const match of removeFencedCode(source).matchAll(
    /^#{1,6}\s+(.+?)\s*#*\s*$/gm,
  )) {
    const base = slugifyHeading(match[1]);
    if (!base) continue;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  }
  return result;
}

function links(source) {
  const clean = removeFencedCode(source);
  const values = [];
  for (const match of clean.matchAll(
    /\[[^\]]*\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g,
  )) {
    values.push(match[1]);
  }
  for (const match of clean.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    values.push(match[1]);
  }
  return values;
}

function normalizeRoute(pathname) {
  let route = pathname || "/";
  route = route.replace(/\.(?:md|mdx)$/i, "");
  if (!route.startsWith("/")) route = `/${route}`;
  if (extname(route)) return route;
  return route.endsWith("/") ? route : `${route}/`;
}

function resolveLinkRoute(sourceRoute, pathname) {
  if (pathname.startsWith("/")) return normalizeRoute(pathname);
  return normalizeRoute(posix.resolve(sourceRoute, "..", pathname));
}

export function inspectContent({ contentRoot, publicRoot }) {
  const files = walk(contentRoot, (file) =>
    MARKDOWN_EXTENSION.test(file),
  ).sort();
  const records = files.map((file) => {
    const source = readFileSync(file, "utf8");
    return {
      file,
      route: routeForFile(contentRoot, file),
      source,
      metadata: frontmatter(source),
      headings: headings(source),
    };
  });
  const recordsByRoute = new Map();
  const errors = [];

  for (const record of records) {
    const display = relative(contentRoot, record.file).split(sep).join("/");
    if (!record.metadata.title?.trim())
      errors.push(`${display}: missing frontmatter title`);
    if (!record.metadata.description?.trim())
      errors.push(`${display}: missing frontmatter description`);
    const previous = recordsByRoute.get(record.route);
    if (previous) {
      errors.push(
        `${display}: duplicate route ${record.route} (also ${relative(contentRoot, previous.file)})`,
      );
    } else {
      recordsByRoute.set(record.route, record);
    }
  }

  const publicPaths = new Set(
    walk(publicRoot, (file) => statSync(file).isFile()).map(
      (file) => `/${relative(publicRoot, file).split(sep).join("/")}`,
    ),
  );
  const knownPageRoutes = new Set(["/", ...recordsByRoute.keys()]);

  for (const record of records) {
    const display = relative(contentRoot, record.file).split(sep).join("/");
    for (const rawLink of links(record.source)) {
      if (
        !rawLink ||
        rawLink.startsWith("//") ||
        EXTERNAL_SCHEME.test(rawLink) ||
        rawLink.startsWith("mailto:")
      ) {
        continue;
      }
      const [rawPathname, rawFragment] = rawLink.split("#", 2);
      const pathname = decodeURIComponent(rawPathname.split("?", 1)[0]);
      let targetRecord = record;

      if (pathname) {
        const route =
          !pathname.startsWith("/") && MARKDOWN_EXTENSION.test(pathname)
            ? routeForFile(contentRoot, resolve(dirname(record.file), pathname))
            : resolveLinkRoute(record.route, pathname);
        targetRecord = recordsByRoute.get(route);
        if (!targetRecord) {
          const publicPath = pathname.startsWith("/")
            ? pathname
            : posix.resolve(record.route, "..", pathname);
          if (publicPaths.has(publicPath)) continue;
          if (!knownPageRoutes.has(route)) {
            errors.push(`${display}: unresolved local link ${rawLink}`);
            continue;
          }
        }
      }

      if (rawFragment && targetRecord) {
        const fragment = decodeURIComponent(rawFragment).toLowerCase();
        if (!targetRecord.headings.has(fragment)) {
          errors.push(`${display}: unresolved heading fragment ${rawLink}`);
        }
      }
    }
  }

  return { records, errors };
}

export function runContentCheck({ contentRoot, publicRoot }) {
  const { records, errors } = inspectContent({ contentRoot, publicRoot });
  if (errors.length > 0) {
    throw new Error(
      `Documentation content check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
  return records.length;
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const packageRoot = resolve(dirname(scriptPath), "..");
  try {
    const count = runContentCheck({
      contentRoot: join(packageRoot, "src/content/docs"),
      publicRoot: join(packageRoot, "public"),
    });
    console.log(`Documentation content check passed (${count} pages).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
