#!/usr/bin/env node
// Doc checks. Node >= 18, no dependencies. Run from repo root. Report-only.
//   node doccheck.mjs links   [PATH...]  broken relative links/#anchors in .md and .html (default: docs)
//   node doccheck.mjs refs    [PATH...]  backticked repo paths/symbols absent from code (advisory, WARN only)
//   node doccheck.mjs hygiene [DOCS]     debt/index integrity (ERROR); size, MUST density, stale drafts,
//                                        roadmap links, glossary (WARN)            (default DOCS: docs)
// Exit: 0 = ok or WARN only; 1 = any ERROR; 2 = usage error, path not found, internal error.
// Not checked: root-relative (/x) links, agent-guidance block, links inside HTML comments.
// Silence a size WARN on a deliberately long file with <!-- size: reviewed -->.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

const SIZE_WARN = { readme: 250, page: 500, proposal: 150 };
const MUST_MAX = 10;
const STALE_DAYS = 180;

const read = (p) => readFileSync(p, "utf8").replace(/\r\n?/g, "\n");
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const posix = (p) => p.split(sep).join("/");
const dec = (x) => {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
};
const stripFences = (s) =>
  s.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
// Linear scan: drops every comment, including an unterminated trailing one.
const stripComments = (s) => {
  let out = "";
  let i = 0;
  for (let start; (start = s.indexOf("<!--", i)) !== -1;) {
    out += s.slice(i, start);
    const end = s.indexOf("-->", start + 4);
    if (end === -1) return out;
    i = end + 3;
  }
  return out + s.slice(i);
};
const stripCode = (s) =>
  stripComments(stripFences(s)).replace(/`[^`\n]*`/g, "");
const git = (...a) => {
  const r = spawnSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : null;
};
const inGit = () =>
  git("rev-parse", "--is-inside-work-tree")?.trim() === "true";

function walk(p, exts) {
  if (!isDir(p)) return existsSync(p) ? [p] : [];
  return readdirSync(p, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const q = join(p, e.name);
      if (!existsSync(q)) return []; // dangling symlink
      return isDir(q)
        ? walk(q, exts)
        : exts.includes(extname(e.name))
          ? [q]
          : [];
    });
}

function targets(args, exts, fallback) {
  const list = args.length ? args : [fallback];
  for (const a of list) if (!existsSync(a)) usage(`path not found: ${a}`);
  return list.flatMap((a) => walk(a, exts));
}

// GitHub-style heading slugs (ATX + setext), with -1, -2 suffixes for duplicates. Cached.
const anchorCache = new Map();
function anchors(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const src = read(file);
  const ids = new Set(
    [...src.matchAll(/\b(?:id|name)\s*=\s*["']?([^"'\s>]+)/gi)].map(
      (m) => m[1],
    ),
  );
  if (extname(file) !== ".html") {
    const body = stripFences(src).replace(
      /^([^\n#>\-*|][^\n]*)\n(=+|-{2,})[ \t]*$/gm,
      "# $1",
    );
    const seen = new Map();
    for (const [, h] of body.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      const base = h
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[`*~]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      ids.add(n ? `${base}-${n}` : base);
    }
  }
  anchorCache.set(file, ids);
  return ids;
}

const HREF = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
function linkTargets(file) {
  const src = read(file);
  const html = (s) => [...s.matchAll(HREF)].map((m) => m[1] ?? m[2] ?? m[3]);
  if (extname(file) === ".html") return html(stripComments(src));
  const s = stripCode(src);
  // Inline links allow one level of balanced parentheses in the target.
  const inline = [
    ...s.matchAll(
      /\]\(\s*(<[^>]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+["'(][^)]*)?\s*\)/g,
    ),
  ].map((m) => m[1].replace(/^<|>$/g, ""));
  const refdef = [...s.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)].map(
    (m) => m[1],
  );
  return [...inline, ...refdef, ...html(s)];
}

const external = (t) =>
  /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//") || t.startsWith("/");
const splitTarget = (t) => {
  const [p, f] = t.split("#");
  return [dec(p.split("?")[0]), f && dec(f)];
};

function checkLink(file, t) {
  if (!t || external(t)) return null;
  const [path, frag] = splitTarget(t);
  const dest = path ? resolve(dirname(file), path) : resolve(file);
  if (!existsSync(dest)) return `ERROR ${posix(file)}: ${t} (missing)`;
  if (
    frag &&
    !isDir(dest) &&
    [".md", ".html"].includes(extname(dest)) &&
    !anchors(dest).has(frag)
  )
    return `ERROR ${posix(file)}: ${t} (anchor)`;
  return null;
}

function links(args) {
  return targets(args, [".md", ".html"], "docs").flatMap((f) =>
    linkTargets(f)
      .map((t) => checkLink(f, t))
      .filter(Boolean),
  );
}

const PATHISH = /^\.{0,2}[\\/]?[\w.-]+([\\/][\w.-]+)+[\\/]?$/;
const IDENT = /^(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)(?:\(.*\))?$/;
const CODEISH =
  /^(?:[A-Z][a-z0-9]+[A-Z]\w*|[A-Z][A-Z0-9]*_[A-Z0-9_]+|[a-z][a-z0-9]*_[a-z0-9_]+)$/;

// Advisory. Blind spots: path:line / #L anchors / globs are skipped; a symbol found only in a comment counts as found.
function refs(args) {
  if (!inGit()) return ["WARN refs: not a git work tree; skipped"];
  const files = (
    git(
      "-c",
      "core.quotepath=off",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ) ?? ""
  )
    .split("\0")
    .filter(Boolean);
  const dirs = new Set(files.flatMap((x) => x.split("/").slice(0, -1)));
  const symCache = new Map();
  const symFound = (s) => {
    if (!symCache.has(s))
      symCache.set(
        s,
        spawnSync("git", [
          "grep",
          "--untracked",
          "-qwI",
          s,
          "--",
          ".",
          ":!*.md",
          ":!*.html",
        ]).status !== 1,
      );
    return symCache.get(s);
  };
  const out = [];
  for (const f of targets(args, [".md"], "docs")) {
    const toks = new Set(
      [...stripFences(read(f)).matchAll(/`([^`\n]+)`/g)].map((m) =>
        m[1].trim().replace(/[,.]$/, ""),
      ),
    );
    for (const tok of toks) {
      if (/\s|=/.test(tok)) continue;
      if (PATHISH.test(tok)) {
        const t = tok
          .replace(/\\/g, "/")
          .replace(/^\.{0,2}\//, "")
          .replace(/\/$/, "");
        if (!dirs.has(t.split("/")[0])) continue; // runtime path, not a repo path
        const hit = files.some(
          (x) =>
            x === t ||
            x.endsWith("/" + t) ||
            x.startsWith(t + "/") ||
            x.includes("/" + t + "/"),
        );
        if (!hit)
          out.push(
            `WARN ${posix(f)}: \`${tok}\` (path not found; confirm before acting)`,
          );
        continue;
      }
      const m = IDENT.exec(tok);
      if (m && CODEISH.test(m[1]) && !symFound(m[1]))
        out.push(
          `WARN ${posix(f)}: \`${tok}\` (symbol not found; confirm before acting)`,
        );
    }
  }
  return out;
}

// Known-debt markers: blockquote starting with optional bold "Known debt:" (case-insensitive).
const DEBT =
  /^[ \t]*>[ \t]*\**known debt\**[ \t]*:[\s\S]*?(?=\n(?![ \t]*>)|(?![\s\S]))/gim;
const DEBT_LOOSE = /^[ \t]*(?:[-*+][ \t]+)?\**known debt\**[ \t]*:/gim;

function hygiene(args) {
  const docs = normalize(args[0] ?? "docs").replace(/[\\/]$/, "");
  if (!isDir(docs)) usage(`docs directory not found: ${docs}`);
  const arch = join(docs, "architecture");
  const prop = join(docs, "proposals");
  const under = (f, d) => !relative(d, f).startsWith("..");
  const linksTo = (from, to) =>
    linkTargets(from).some((t) => {
      if (external(t)) return false;
      const p = resolve(dirname(from), splitTarget(t)[0] || basename(from));
      return (
        p === resolve(to) ||
        (isDir(p) && resolve(p, "README.md") === resolve(to))
      );
    });
  const out = [];

  for (const f of walk(docs, [".md"])) {
    const s = read(f);
    const kind =
      basename(f) === "README.md" && [docs, arch, prop].includes(dirname(f))
        ? "readme"
        : under(f, prop)
          ? "proposal"
          : "page";
    const n = s.split("\n").length;
    if (n > SIZE_WARN[kind] && !s.includes("<!-- size: reviewed -->"))
      out.push(
        `WARN ${posix(f)}: size ${n} lines (> ~${SIZE_WARN[kind]}). Informational; length may be justified.`,
      );
    if (!under(f, arch)) continue;
    const prose = stripCode(s);
    const musts = (prose.match(/\bMUST\b/g) ?? []).length;
    if (musts > MUST_MAX)
      out.push(
        `WARN ${posix(f)}: ${musts} MUST rules (> ${MUST_MAX}); demote some to Default?`,
      );
    const blocks = [...prose.matchAll(DEBT)].map((m) => m[0]);
    if ((prose.match(DEBT_LOOSE) ?? []).length)
      out.push(
        `ERROR ${posix(f)}: Known debt must be a blockquote ("> **Known debt:** ...")`,
      );
    for (const blk of blocks) {
      const t = [...blk.matchAll(/\]\(([^)\s]*proposals\/[^)\s]*)\)/g)].map(
        (m) => splitTarget(m[1])[0],
      )[0];
      if (!t) {
        out.push(`ERROR ${posix(f)}: Known debt without proposal link`);
        continue;
      }
      let p = resolve(dirname(f), t);
      if (isDir(p)) p = join(p, "README.md");
      if (!existsSync(p)) continue; // reported by `links`
      if (!linksTo(p, f))
        out.push(
          `ERROR ${posix(relative(".", p))}: debt proposal does not link back to ${posix(f)}`,
        );
    }
  }

  const readme = join(arch, "README.md");
  if (isDir(arch) && !existsSync(join(arch, "glossary.md")))
    out.push(`WARN ${posix(arch)}/glossary.md: missing`);
  else if (existsSync(readme) && !linksTo(readme, join(arch, "glossary.md")))
    out.push(`WARN ${posix(readme)}: does not link glossary.md`);

  const idx = join(prop, "README.md");
  if (!existsSync(idx)) return out;
  const entryOf = (p) => (isDir(p) ? join(p, "README.md") : p);
  const listed = new Set(
    linkTargets(idx)
      .filter(
        (t) => t && !external(t) && !t.startsWith("#") && !t.startsWith("../"),
      )
      .map((t) => resolve(entryOf(resolve(prop, splitTarget(t)[0]))))
      .filter((p) => under(p, resolve(prop))),
  );
  for (const p of listed)
    if (!existsSync(p))
      out.push(
        `ERROR ${posix(idx)}: index points to missing ${posix(relative(".", p))}`,
      );
  const gitOk = inGit();
  for (const name of readdirSync(prop).sort()) {
    const p = join(prop, name);
    if (
      name === "README.md" ||
      !existsSync(p) ||
      (!isDir(p) && extname(name) !== ".md")
    )
      continue;
    const entry = entryOf(p);
    if (!existsSync(entry)) {
      out.push(`ERROR ${posix(p)}: folder proposal without README.md`);
      continue;
    }
    if (!listed.has(resolve(entry)))
      out.push(`ERROR ${posix(entry)}: not in proposals index`);
    const ts = gitOk ? git("log", "-1", "--format=%ct", "--", p)?.trim() : "";
    if (
      ts &&
      Date.now() / 1000 - Number(ts) > STALE_DAYS * 86400 &&
      /Status:?\**:?\s*Draft/i.test(read(entry))
    )
      out.push(
        `WARN ${posix(entry)}: Draft untouched > ${STALE_DAYS} days (ask: revive, reject, keep)`,
      );
  }
  const roadmap =
    /^## Roadmap\b([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(
      stripCode(read(idx)),
    )?.[1] ?? "";
  // An item is a "- [ ]" / "* [ ]" line plus its indented continuation lines.
  for (const [item] of roadmap.matchAll(
    /^\s*[-*+] \[[ xX]\][^\n]*(?:\n[ \t]+\S[^\n]*)*/gm,
  )) {
    const ok = [...item.matchAll(/\]\(([^)\s]+)\)/g)].some(
      (m) => !external(m[1]) && /(\.md|\/)$/.test(splitTarget(m[1])[0]),
    );
    if (!ok)
      out.push(
        `WARN ${posix(idx)}: roadmap item without proposal link: ${item.trim().split("\n")[0].slice(0, 70)}`,
      );
  }
  return out;
}

function usage(msg) {
  if (msg) console.error(`doccheck: ${msg}`);
  console.error("usage: node doccheck.mjs links|refs|hygiene [PATH...]");
  process.exit(2);
}

const [cmd, ...args] = process.argv.slice(2);
const run = { links, refs, hygiene }[cmd];
if (!run) usage();
let res;
try {
  res = run(args);
} catch (e) {
  console.error(`doccheck: internal error: ${e.message}`);
  process.exit(2);
}
const errors = res.filter((r) => r.startsWith("ERROR")).length;
console.log(
  res.length
    ? `${res.join("\n")}\n${cmd}: ${errors} ERROR, ${res.length - errors} WARN`
    : `${cmd}: ok`,
);
process.exit(errors ? 1 : 0);
