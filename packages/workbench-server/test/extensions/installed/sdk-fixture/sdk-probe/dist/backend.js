(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // nerve-extension-api-runtime:extension-api
  var require_extension_api = __commonJS({
    "nerve-extension-api-runtime:extension-api"(exports, module) {
      module.exports = globalThis.__nerveExtensionApi;
    }
  });

  // src/extension.ts
  var import_extension_sdk3 = __toESM(require_extension_api(), 1);

  // src/backend/namespace.ts
  var import_extension_sdk2 = __toESM(require_extension_api(), 1);

  // src/backend/get.ts
  var import_extension_sdk = __toESM(require_extension_api(), 1);
  var get = (0, import_extension_sdk.method)({
    risk: "external_read",
    signature: "/** GET a path on the configured server and return the parsed JSON (or text). */ get(path: string): Promise<unknown>",
    // A script passes the path; a direct tool bound to this method passes its arguments object.
    parse: (args) => {
      const first = args[0];
      const path = typeof first === "string" ? first : first?.path;
      if (typeof path !== "string" || !path.startsWith("/"))
        throw new import_extension_sdk.ExtensionError(
          "BAD_REQUEST",
          "get needs a path that starts with '/'.",
          { fix: 'Pass a path such as "/items".' }
        );
      return { path };
    },
    authorize: ({ path }) => [
      { targets: [`sdk-probe:path${path}`], summary: `GET ${path}` }
    ],
    run: async (_session, { path }, ctx) => {
      const server = String(ctx.settings.get("server") ?? "").replace(/\/+$/, "");
      const response = await ctx.http.request({ url: `${server}${path}` });
      if (!response.ok)
        throw new import_extension_sdk.ExtensionError(
          "SERVER_ERROR",
          `The server answered ${response.status}.`,
          { fix: "Check the server setting and the path." }
        );
      return response.body;
    }
  });

  // src/backend/namespace.ts
  var namespace = (0, import_extension_sdk2.defineNamespace)({
    id: "sdkProbe",
    label: "Sdk Probe",
    summary: "Sdk Probe: get(path) reads JSON from the configured server.",
    types: "",
    docs: [
      {
        id: "sdk-probe/usage",
        whenToRead: "before reading from the Sdk Probe server: paths and errors",
        file: "docs/usage.md"
      }
    ],
    methods: { get }
  });

  // src/extension.ts
  var extension_default = (0, import_extension_sdk3.defineExtension)({
    id: "sdk-probe",
    apiVersion: 1,
    name: "Sdk Probe",
    description: "Reads data from a server the user configures.",
    icon: "globe",
    enabledByDefault: false,
    settings: {
      version: 1,
      fields: {
        server: {
          type: "string",
          label: "Server",
          description: "Base URL of the server; requests are sent to it.",
          format: "url",
          default: "https://example.com"
        }
      }
    },
    permissions: { network: ["{settings.server}"] },
    namespaces: [namespace],
    tools: [
      {
        name: "sdk_probe_get",
        description: "Read JSON from the configured Sdk Probe server.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path starting with '/'." }
          },
          required: ["path"],
          additionalProperties: false
        },
        method: "sdkProbe.get"
      }
    ]
  });

  // nerve-entry.ts
  globalThis.__nerveExtension = extension_default;
})();
