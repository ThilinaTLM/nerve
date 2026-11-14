/* eslint-disable @typescript-eslint/no-explicit-any -- method tables hold methods of different session and input types */
import { image } from "@nervekit/native";
import type {
  AccountInfo,
  ArtifactInfo,
  ArtifactRef,
  ExtensionContext,
  ExtensionDefinition,
  NamespaceDefinition,
} from "@nervekit/extension-api";
import { ExtensionError } from "@nervekit/extension-api";
import { resolveToolPath } from "../../execution/index.js";
import {
  artifactTempPath,
  commitArtifact,
  mediaTypeFor,
  parseHandle,
  readFileRef,
  statFileRef,
  writeArtifact,
} from "../runtime/files/artifacts.js";
import type { SdkEnvironment } from "../runtime/sdk-types.js";
import { createHttp } from "./http.js";

/**
 * The per-run side of the extension API: builds each extension's `ctx` through
 * the host ports (lazily, once per extension) and holds the namespace sessions
 * (created on first use). One instance per `quick_script` run.
 */
export class ExtensionRuntime {
  readonly #contexts = new Map<string, ExtensionContext>();
  readonly #sessions = new Map<string, Promise<unknown>>();
  /** Workspace files the run is allowed to read through `ctx.artifacts.read`: paths whose `read` check passed. */
  readonly #authorizedReads = new Set<string>();

  constructor(private readonly env: SdkEnvironment) {}

  /** Called after a call's checks passed: its `read` authorizations open those files to `ctx.artifacts.read`. */
  allowReads(paths: readonly string[]): void {
    for (const path of paths)
      this.#authorizedReads.add(resolveToolPath(this.env.context.cwd, path));
  }

  session(
    definition: ExtensionDefinition,
    namespace: NamespaceDefinition<any>,
  ): Promise<unknown> {
    const key = `${definition.id}/${namespace.id}`;
    let session = this.#sessions.get(key);
    if (!session) {
      session = Promise.resolve().then(() =>
        namespace.session?.(this.context(definition)),
      );
      this.#sessions.set(key, session);
    }
    return session;
  }

  context(definition: ExtensionDefinition): ExtensionContext {
    let ctx = this.#contexts.get(definition.id);
    if (!ctx) {
      ctx = this.#build(definition);
      this.#contexts.set(definition.id, ctx);
    }
    return ctx;
  }

  #build(definition: ExtensionDefinition): ExtensionContext {
    const { env } = this;
    const ports = env.context.extensionPorts;
    if (!ports)
      throw new Error("Extensions are not available in this context.");
    const settings = ports.settings(definition.id);
    const accountKind = (field: string): string | undefined => {
      const declared = definition.settings.fields[field];
      return declared?.type === "account" ? declared.kind : undefined;
    };
    const selected = async (
      field: string,
    ): Promise<AccountInfo | undefined> => {
      const kind = accountKind(field);
      const id = settings[field];
      return kind && typeof id === "string" && id
        ? await ports.accounts.get(kind, id)
        : undefined;
    };
    const signal = env.context.signal ?? new AbortController().signal;
    const readWorkspaceOrArtifact = async (handle: string) => {
      const ref = parseHandle(handle, env);
      if (ref.kind === "workspace" && !this.#authorizedReads.has(ref.path))
        throw new ExtensionError(
          "DENIED",
          `${handle}: reading this file was not authorized for the call; declare it in authorize() as a read.`,
        );
      return ref;
    };
    const reported = (handle: string): ArtifactRef => {
      const entry = env.report.artifacts.get(handle)!;
      return {
        handle,
        name: handle.slice("artifact:".length),
        bytes: entry.bytes,
        mediaType: entry.mediaType,
      };
    };
    const accountFieldKinds = Object.entries(definition.settings.fields)
      .filter(([, field]) => field.type === "account")
      .map(([name]) => name);
    const http = createHttp({
      extensionName: definition.name,
      network: definition.permissions?.network ?? [],
      kinds: Object.fromEntries(
        Object.entries(definition.accounts ?? {}).map(([kind, def]) => [
          kind,
          { label: def.label, auth: def.auth, origins: def.origins },
        ]),
      ),
      kindOfField: accountKind,
      settings,
      selected,
      allSelected: async () =>
        (await Promise.all(accountFieldKinds.map(selected))).filter(
          (account): account is AccountInfo => account !== undefined,
        ),
      secret: (kind, id) => ports.accounts.secret(kind, id),
      signal,
      allowPrivateNetwork: env.context.webFetchPolicy?.allowPrivateNetwork,
      readHandle: async (handle) => {
        const ref = await readWorkspaceOrArtifact(handle);
        return new Uint8Array(await readFileRef(ref));
      },
      artifactSink: () => ({
        prepare: () => artifactTempPath(env),
        commit: async (path, name) =>
          reported(await commitArtifact(env, path, name)),
      }),
    });
    const generateImage = ports.generateImage;
    return {
      settings: { get: <T>(key: string) => settings[key] as T | undefined },
      accounts: { selected },
      http,
      artifacts: {
        write: async (name, data, mediaType) => {
          const bytes =
            typeof data === "string" ? new TextEncoder().encode(data) : data;
          const handle = await writeArtifact(env, name, bytes);
          if (mediaType)
            env.report.artifacts.get(handle)!.mediaType = mediaType;
          return reported(handle);
        },
        read: async (handle) => {
          const ref = await readWorkspaceOrArtifact(handle);
          const bytes = await readFileRef(ref);
          return {
            bytes: new Uint8Array(bytes),
            mediaType: mediaTypeFor(ref.path),
            name:
              ref.kind === "artifact" ? ref.name : ref.path.split("/").pop()!,
          };
        },
        info: async (handle): Promise<ArtifactInfo> => {
          const ref = await readWorkspaceOrArtifact(handle);
          const bytes = await statFileRef(ref);
          const mediaType = mediaTypeFor(ref.path);
          const dimensions =
            mediaType === "image/png" || mediaType === "image/jpeg"
              ? await readFileRef(ref)
                  .then((data) => image.imageInfo(data))
                  .then((info) => ({ width: info.width, height: info.height }))
                  .catch(() => ({}))
              : {};
          return {
            handle,
            name:
              ref.kind === "artifact" ? ref.name : ref.path.split("/").pop()!,
            bytes,
            mediaType,
            ...dimensions,
          };
        },
      },
      report: {
        created: (entry) => void env.report.created.push(entry),
        updated: (entry) => void env.report.updated.push(entry),
        deleted: (entry) => void env.report.deleted.push(entry),
        note: (text) => void env.report.notes.push(text),
      },
      models: {
        ...(generateImage &&
        definition.permissions?.capabilities?.includes("models.image")
          ? {
              image: {
                generate: async (request) =>
                  await generateImage({
                    prompt: request.prompt,
                    inputs: [...request.inputs],
                    options: {
                      ...request.options,
                      backend: request.options.backend as "openai-codex",
                    },
                    signal,
                  }),
              },
            }
          : {}),
      },
      signal,
      log: {
        debug: (message, data) =>
          ports.log?.("debug", definition.id, message, data),
        warn: (message, data) =>
          ports.log?.("warn", definition.id, message, data),
      },
    };
  }
}
