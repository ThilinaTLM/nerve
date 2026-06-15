import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExecutionEnv,
  FileInfo,
  FileKind,
} from "../src/harness/env/types.js";
import { FileError } from "../src/harness/errors.js";
import { loadSkills } from "../src/harness/skills/loader.js";

type MemoryEntry = { kind: "directory" } | { kind: "file"; content: string };

class MemoryExecutionEnv implements ExecutionEnv {
  cwd: string;
  private readonly entries = new Map<string, MemoryEntry>();

  constructor(root: string, files: Record<string, string>) {
    this.cwd = normalizePath(root);
    this.entries.set(this.cwd, { kind: "directory" });
    for (const [path, content] of Object.entries(files)) {
      const normalized = normalizePath(path);
      this.addParentDirs(normalized);
      this.entries.set(normalized, { kind: "file", content });
    }
  }

  async absolutePath(path: string) {
    return { ok: true as const, value: normalizePath(path) };
  }

  async joinPath(parts: string[]) {
    const separator = parts.some((part) => part.includes("\\")) ? "\\" : "/";
    return { ok: true as const, value: normalizePath(parts.join(separator)) };
  }

  async readTextFile(path: string) {
    const normalized = normalizePath(path);
    const entry = this.entries.get(normalized);
    if (!entry) return notFound(normalized);
    if (entry.kind !== "file") {
      return {
        ok: false as const,
        error: new FileError("is_directory", "Path is a directory", normalized),
      };
    }
    return { ok: true as const, value: entry.content };
  }

  async readTextLines(path: string) {
    const content = await this.readTextFile(path);
    if (!content.ok) return content;
    return { ok: true as const, value: content.value.split(/\r?\n/) };
  }

  async readBinaryFile(path: string) {
    const content = await this.readTextFile(path);
    if (!content.ok) return content;
    return {
      ok: true as const,
      value: new TextEncoder().encode(content.value),
    };
  }

  async writeFile() {
    return unsupported();
  }

  async appendFile() {
    return unsupported();
  }

  async fileInfo(path: string) {
    const normalized = normalizePath(path);
    const entry = this.entries.get(normalized);
    if (!entry) return notFound(normalized);
    return { ok: true as const, value: fileInfo(normalized, entry.kind) };
  }

  async listDir(path: string) {
    const normalized = normalizePath(path);
    const entry = this.entries.get(normalized);
    if (!entry) return notFound(normalized);
    if (entry.kind !== "directory") {
      return {
        ok: false as const,
        error: new FileError(
          "not_directory",
          "Path is not a directory",
          normalized,
        ),
      };
    }
    const children = [...this.entries]
      .filter(([childPath]) => parentPath(childPath) === normalized)
      .map(([childPath, childEntry]) => fileInfo(childPath, childEntry.kind));
    return { ok: true as const, value: children };
  }

  async canonicalPath(path: string) {
    const normalized = normalizePath(path);
    return this.entries.has(normalized)
      ? { ok: true as const, value: normalized }
      : notFound(normalized);
  }

  async exists(path: string) {
    return { ok: true as const, value: this.entries.has(normalizePath(path)) };
  }

  async createDir() {
    return unsupported();
  }

  async remove() {
    return unsupported();
  }

  async createTempDir() {
    return unsupported();
  }

  async createTempFile() {
    return unsupported();
  }

  async exec() {
    return {
      ok: true as const,
      value: { stdout: "", stderr: "", exitCode: 0 },
    };
  }

  async cleanup() {}

  private addParentDirs(path: string): void {
    let current = parentPath(path);
    while (current && !this.entries.has(current)) {
      this.entries.set(current, { kind: "directory" });
      const parent = parentPath(current);
      if (parent === current) break;
      current = parent;
    }
  }
}

function isAsciiLetter(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isPathSeparator(char: string | undefined): boolean {
  return char === "/" || char === "\\";
}

function isWindowsDriveRootPath(path: string): boolean {
  if (path.length < 3 || !isAsciiLetter(path[0]) || path[1] !== ":") {
    return false;
  }
  for (let index = 2; index < path.length; index += 1) {
    if (!isPathSeparator(path[index])) return false;
  }
  return true;
}

function normalizePath(path: string): string {
  if (isWindowsDriveRootPath(path)) return path.slice(0, 3);
  let end = path.length;
  while (end > 0 && isPathSeparator(path[end - 1])) end -= 1;
  return end === 0 ? path : path.slice(0, end);
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  const slashIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (slashIndex === -1) return "";
  if (slashIndex === 0) return normalized.slice(0, 1);
  if (slashIndex === 2 && /^[A-Za-z]:[\\/]/.test(normalized)) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, slashIndex);
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const slashIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

function fileInfo(path: string, kind: FileKind): FileInfo {
  return { name: basename(path), path, kind, size: 0, mtimeMs: 0 };
}

function notFound(path: string) {
  return {
    ok: false as const,
    error: new FileError("not_found", "Path not found", path),
  };
}

function unsupported() {
  return {
    ok: false as const,
    error: new FileError("not_supported", "Not supported by test env"),
  };
}

function skillContent(
  description = "Useful test skill for cross platform loading.",
): string {
  return `---\ndescription: ${description}\n---\n\nFollow the instructions.`;
}

describe("skill loader Windows paths", () => {
  it("normalizes trailing separators without trimming roots", () => {
    assert.equal(normalizePath("C:\\Users\\alice\\\\"), "C:\\Users\\alice");
    assert.equal(normalizePath("C:\\\\"), "C:\\");
    assert.equal(normalizePath("/tmp/project///"), "/tmp/project");
    assert.equal(normalizePath("///"), "///");
  });

  it("loads a nested skill under a Windows absolute root", async () => {
    const root = String.raw`C:\Users\alice\.pi\agent\skills`;
    const env = new MemoryExecutionEnv(root, {
      [`${root}\\category\\agent-browser\\SKILL.md`]: skillContent(),
    });

    const result = await loadSkills(env, root);

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
      result.skills.map((skill) => skill.name),
      ["agent-browser"],
    );
  });

  it("honors root ignore files with Windows paths", async () => {
    const root = String.raw`C:\Users\alice\.pi\agent\skills`;
    const env = new MemoryExecutionEnv(root, {
      [`${root}\\.gitignore`]: "agent-browser/\n",
      [`${root}\\agent-browser\\SKILL.md`]: skillContent(),
    });

    const result = await loadSkills(env, root);

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.skills, []);
  });

  it("prefixes nested ignore files with POSIX-style relative paths for Windows paths", async () => {
    const root = String.raw`C:\Users\alice\.pi\agent\skills`;
    const env = new MemoryExecutionEnv(root, {
      [`${root}\\category\\.gitignore`]: "ignored/\n",
      [`${root}\\category\\ignored\\SKILL.md`]: skillContent(),
      [`${root}\\category\\kept\\SKILL.md`]: skillContent(),
    });

    const result = await loadSkills(env, root);

    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(
      result.skills.map((skill) => skill.name),
      ["kept"],
    );
  });
});
