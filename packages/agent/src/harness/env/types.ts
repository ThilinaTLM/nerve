import type { FileError, ExecutionError } from "../errors.js";
import type { Result } from "../result.js";

/** Kind of filesystem object as addressed by a {@link FileSystem}. Symlinks are not followed automatically. */
export type FileKind = "file" | "directory" | "symlink";

/** Metadata for one filesystem object in a {@link FileSystem}. */
export interface FileInfo {
  /** Basename of {@link path}. */
  name: string;
  /** Absolute, syntactically normalized addressed path in the execution environment. Symlinks are not followed. */
  path: string;
  /** Object kind. Symlink targets are not followed; use {@link FileSystem.canonicalPath} explicitly. */
  kind: FileKind;
  /** Size in bytes for the addressed filesystem object. */
  size: number;
  /** Modification time as milliseconds since Unix epoch. */
  mtimeMs: number;
}

/** Options for {@link Shell.exec}. */
export interface ExecutionEnvExecOptions {
  /** Working directory for the command. Relative paths are resolved against {@link ExecutionEnv.cwd}. Defaults to {@link ExecutionEnv.cwd}. */
  cwd?: string;
  /** Additional environment variables for the command. Values override the environment defaults. Defaults to no overrides. */
  env?: Record<string, string>;
  /** Timeout in seconds. Implementations should return a timeout error when the command exceeds this duration. Defaults to no timeout. */
  timeout?: number;
  /** Abort signal used to terminate the command. Defaults to no abort signal. */
  abortSignal?: AbortSignal;
  /** Called with stdout chunks as they are produced. */
  onStdout?: (chunk: string) => void;
  /** Called with stderr chunks as they are produced. */
  onStderr?: (chunk: string) => void;
}

/**
 * Filesystem capability used by the harness.
 *
 * Paths passed to methods may be absolute or relative to {@link cwd}. Paths returned by file operations are addressed paths
 * in the filesystem namespace, but are not canonicalized through symlinks unless returned by {@link canonicalPath}.
 *
 * Operation methods must never throw or reject. All filesystem failures, including unexpected backend failures, must be
 * encoded in the returned {@link Result}. Implementations must preserve this invariant.
 */
export interface FileSystem {
  /** Current working directory for relative paths. */
  cwd: string;

  /** Return an absolute addressed path without requiring it to exist and without resolving symlinks. */
  absolutePath(
    path: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>>;
  /** Join path segments in the filesystem namespace without requiring the result to exist. */
  joinPath(
    parts: string[],
    abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>>;
  /** Read a UTF-8 text file. */
  readTextFile(
    path: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>>;
  /** Read UTF-8 text lines. Implementations should stop once `maxLines` lines have been read. */
  readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>>;
  /** Read a binary file. */
  readBinaryFile(
    path: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<Uint8Array, FileError>>;
  /** Create or overwrite a file, creating parent directories when supported. */
  writeFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>>;
  /** Create or append to a file, creating parent directories when supported. */
  appendFile(
    path: string,
    content: string | Uint8Array,
    abortSignal?: AbortSignal,
  ): Promise<Result<void, FileError>>;
  /** Return metadata for the addressed path without following symlinks. */
  fileInfo(
    path: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<FileInfo, FileError>>;
  /** List direct children of a directory without following symlinks. */
  listDir(
    path: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<FileInfo[], FileError>>;
  /** Return the canonical path for an existing path, resolving symlinks where supported. */
  canonicalPath(
    path: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>>;
  /** Return false for missing paths. Other errors, such as permission failures, return a {@link FileError}. */
  exists(
    path: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<boolean, FileError>>;
  /** Create a directory. Defaults: `recursive: true`, no abort signal. */
  createDir(
    path: string,
    options?: { recursive?: boolean; abortSignal?: AbortSignal },
  ): Promise<Result<void, FileError>>;
  /** Remove a file or directory. Defaults: `recursive: false`, `force: false`, no abort signal. */
  remove(
    path: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      abortSignal?: AbortSignal;
    },
  ): Promise<Result<void, FileError>>;
  /** Create a temporary directory and return its absolute path. Defaults: `prefix: "tmp-"`, no abort signal. */
  createTempDir(
    prefix?: string,
    abortSignal?: AbortSignal,
  ): Promise<Result<string, FileError>>;
  /** Create a temporary file and return its absolute path. Defaults: `prefix: ""`, `suffix: ""`, no abort signal. */
  createTempFile(options?: {
    prefix?: string;
    suffix?: string;
    abortSignal?: AbortSignal;
  }): Promise<Result<string, FileError>>;

  /** Release filesystem resources. Must be best-effort and must not throw or reject. */
  cleanup(): Promise<void>;
}

/** Shell execution capability used by the harness. */
export interface Shell {
  /** Execute a shell command in {@link FileSystem.cwd} unless `options.cwd` is provided. */
  exec(
    command: string,
    options?: ExecutionEnvExecOptions,
  ): Promise<
    Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>
  >;
  /** Release shell resources. Must be best-effort and must not throw or reject. */
  cleanup(): Promise<void>;
}

/** Filesystem and process execution environment used by the harness. */
export interface ExecutionEnv extends FileSystem, Shell {}
