import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createDirectory,
  getFilesystemLocations,
  isHiddenDirectory,
  validateDirectoryName,
} from "../../../src/domains/filesystem/filesystem-browser.js";

const hasCode = (code: string) => (error: unknown) =>
  error instanceof Error && "code" in error && error.code === code;

describe("filesystem browser", () => {
  it("derives Windows drives and places without using client or host path rules", async () => {
    const existing = new Set([
      "C:\\",
      "D:\\",
      "Z:\\",
      "C:\\Users\\Ada",
      "C:\\Users\\Ada\\Desktop",
      "C:\\Users\\Ada\\code",
      "C:\\Users\\Ada\\src",
    ]);
    const locations = await getFilesystemLocations({
      platform: "win32",
      home: "C:\\Users\\Ada",
      isDirectory: async (path) => existing.has(path),
    });
    assert.equal(locations.platform, "win32");
    assert.equal(locations.separator, "\\");
    assert.equal(locations.caseInsensitive, true);
    assert.deepEqual(locations.locations, [
      { kind: "drive", label: "C:", path: "C:\\" },
      { kind: "drive", label: "D:", path: "D:\\" },
      { kind: "drive", label: "Z:", path: "Z:\\" },
    ]);
    assert.deepEqual(locations.places, [
      { id: "home", label: "Home", path: "C:\\Users\\Ada" },
      { id: "desktop", label: "Desktop", path: "C:\\Users\\Ada\\Desktop" },
      { id: "projects", label: "Projects", path: "C:\\Users\\Ada\\code" },
    ]);
    assert.ok(
      locations.locations.every(
        (location) => !location.path.includes("This PC"),
      ),
    );
  });

  it("discovers Linux removable locations and prefers the first existing projects directory", async () => {
    const result = await getFilesystemLocations({
      platform: "linux",
      home: "/home/ada",
      username: "ada",
      isDirectory: async (path) => path !== "/media/ada/not-a-directory",
      directoryNames: async (path) =>
        path === "/media/ada" ? ["USB", "not-a-directory"] : ["SD"],
    });
    assert.equal(result.separator, "/");
    assert.equal(result.caseInsensitive, false);
    assert.equal(
      result.places.find((place) => place.id === "projects")?.path,
      "/home/ada/Projects",
    );
    assert.deepEqual(result.locations, [
      { kind: "root", label: "Computer", path: "/" },
      { kind: "removable", label: "USB", path: "/media/ada/USB" },
      { kind: "removable", label: "SD", path: "/run/media/ada/SD" },
    ]);
  });

  it("excludes the macOS boot volume symlink and uses its name for the root", async () => {
    const result = await getFilesystemLocations({
      platform: "darwin",
      home: "/Users/ada",
      isDirectory: async () => true,
      directoryNames: async () => ["External", "Ada HD"],
      realpath: async (path) => (path === "/Volumes/Ada HD" ? "/" : path),
    });
    assert.deepEqual(result.locations, [
      { kind: "root", label: "Ada HD", path: "/" },
      { kind: "volume", label: "External", path: "/Volumes/External" },
    ]);
  });

  it("applies daemon-platform hidden fallback rules", () => {
    for (const platform of ["linux", "darwin", "win32"]) {
      assert.equal(
        isHiddenDirectory(
          platform === "win32" ? "C:\\.config" : "/tmp/.config",
          platform,
        ),
        true,
      );
    }
    assert.equal(
      isHiddenDirectory("C:\\Users\\Ada\\appdata", "win32", "C:\\Users\\ADA"),
      true,
    );
    assert.equal(isHiddenDirectory("C:\\$Recycle.Bin", "win32"), true);
    assert.equal(
      isHiddenDirectory("D:\\System Volume Information", "win32"),
      true,
    );
    assert.equal(
      isHiddenDirectory("C:\\work\\AppData", "win32", "C:\\Users\\Ada"),
      false,
    );
    assert.equal(
      isHiddenDirectory("/Users/ada/Library", "darwin", "/Users/ada"),
      true,
    );
    assert.equal(
      isHiddenDirectory("/work/Library", "darwin", "/Users/ada"),
      false,
    );
    assert.equal(
      isHiddenDirectory("/home/ada/Library", "linux", "/home/ada"),
      false,
    );
  });

  it("rejects path segments and Windows reserved names without banning valid POSIX names", () => {
    for (const platform of ["linux", "darwin", "win32"]) {
      for (const name of ["", ".", "..", "a/b", "a\\b", "a\0b"]) {
        assert.throws(
          () => validateDirectoryName(name, platform),
          hasCode("INVALID_DIRECTORY_NAME"),
        );
      }
      for (const name of ["My project", ".config", "项目", "CONSOLE"]) {
        assert.doesNotThrow(() => validateDirectoryName(name, platform));
      }
    }
    for (const name of [
      "CON",
      "con.txt",
      "NUL",
      "PRN",
      "aux",
      "COM1",
      "LPT9.log",
      "COM¹",
      "LPT².txt",
      "a:b",
      "a?b",
      'a"b',
      "a<b",
      "a>b",
      "a|b",
      "a*b",
      "a\u001fb",
      "trailing.",
      "trailing ",
    ]) {
      assert.throws(
        () => validateDirectoryName(name, "win32"),
        hasCode("INVALID_DIRECTORY_NAME"),
      );
    }
    for (const name of ["con", "a:b", "trailing.", "COM0", "COM10"]) {
      assert.doesNotThrow(() => validateDirectoryName(name, "linux"));
    }
    assert.doesNotThrow(() => validateDirectoryName("COM10", "win32"));
  });

  it("creates only under an existing absolute directory and never overwrites", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-folder-create-"));
    try {
      const result = await createDirectory(root, "New project");
      assert.deepEqual(result, { path: join(root, "New project") });
      assert.equal((await stat(result.path)).isDirectory(), true);
      await assert.rejects(
        createDirectory(root, "New project"),
        hasCode("DIRECTORY_EXISTS"),
      );
      await writeFile(join(root, "file"), "keep");
      await assert.rejects(
        createDirectory(root, "file"),
        hasCode("DIRECTORY_EXISTS"),
      );
      await assert.rejects(
        createDirectory("relative", "name"),
        hasCode("INVALID_DIRECTORY_PARENT"),
      );
      await assert.rejects(
        createDirectory(join(root, "missing"), "name"),
        hasCode("DIRECTORY_PARENT_NOT_FOUND"),
      );
      await assert.rejects(
        createDirectory(join(root, "file"), "name"),
        hasCode("INVALID_DIRECTORY_PARENT"),
      );
      await assert.rejects(
        createDirectory(root, "../escape"),
        hasCode("INVALID_DIRECTORY_NAME"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
