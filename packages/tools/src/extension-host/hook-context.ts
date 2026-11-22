import type {
  AccountTestContext,
  ExtensionContext,
  ExtensionHookContext,
} from "@nervekit/extension-api";

/*
 * The narrowed `ctx` of the hooks that are not calls: `availability` and `configuration` read
 * settings and accounts and ask whether a model is ready; an account kind's `test` reaches the
 * tested account's service. Shared by the in-process adapter and the sandbox runtime library, so
 * both hand the same members (the sandbox host also refuses every other host method).
 */

/** `ctx` of `availability` and `configuration`. */
export function hookContext(ctx: ExtensionHookContext): ExtensionHookContext {
  const { image, vision, text, defaultModel } = ctx.models;
  return {
    settings: ctx.settings,
    accounts: ctx.accounts,
    log: ctx.log,
    models: {
      ...(image ? { image: { ready: image.ready } } : {}),
      ...(vision ? { vision: { ready: vision.ready } } : {}),
      ...(text ? { text: { ready: text.ready } } : {}),
      ...(defaultModel ? { defaultModel } : {}),
    },
  };
}

/** `ctx` of an account kind's `test`. */
export function accountTestContext(
  ctx: Pick<ExtensionContext, "accounts" | "http" | "log">,
): AccountTestContext {
  return { accounts: ctx.accounts, http: ctx.http, log: ctx.log };
}

/** Host methods each operation's `ctx` may call; `run` and `session` may call every method. */
export const HOOK_HOST_METHODS: Readonly<Record<string, ReadonlySet<string>>> =
  {
    availability: new Set([
      "accounts.selected",
      "models.image.ready",
      "models.vision.ready",
      "models.text.ready",
      "models.defaultModel",
      "log.debug",
      "log.warn",
    ]),
    configuration: new Set([
      "accounts.selected",
      "models.image.ready",
      "models.vision.ready",
      "models.text.ready",
      "models.defaultModel",
      "log.debug",
      "log.warn",
    ]),
    testAccount: new Set([
      "accounts.selected",
      "http.request",
      "log.debug",
      "log.warn",
    ]),
  };
