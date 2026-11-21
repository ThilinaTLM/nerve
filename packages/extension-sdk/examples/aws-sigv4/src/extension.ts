import {
  defineExtension,
  defineNamespace,
  ExtensionError,
  method,
} from "@nervekit/extension-sdk";

const request = method({
  risk: "external_read",
  signature:
    "/** GET a URL of an AWS service with the selected account's access key (SigV4) and return the response body. */ get(url: string): Promise<unknown>",
  parse: (args) => {
    const url = args[0];
    if (typeof url !== "string" || !/^https:\/\//.test(url))
      throw new ExtensionError("BAD_REQUEST", "get needs an https URL.");
    return { url };
  },
  run: async (_session, { url }, ctx) =>
    (await ctx.http.request({ url, auth: { account: "account" } })).body,
});

export default defineExtension({
  id: "aws-sigv4",
  name: "AWS (SigV4)",
  description:
    "Calls AWS services with an access key; requests are signed in a credential provider.",
  icon: "globe",
  enabledByDefault: false,
  settings: {
    version: 1,
    fields: {
      account: {
        type: "account",
        kind: "aws-sigv4-access-key",
        label: "AWS account",
      },
    },
  },
  accounts: {
    "aws-sigv4-access-key": {
      label: "AWS access key",
      fields: {
        region: { type: "string", label: "Region", default: "us-east-1" },
        service: {
          type: "string",
          label: "Service",
          description: "The signing name of the service (s3, sts, ec2, ...).",
          default: "s3",
        },
      },
      secrets: {
        accessKeyId: { label: "Access key id" },
        secretAccessKey: { label: "Secret access key" },
        sessionToken: { label: "Session token (optional)" },
      },
      provider: "extension",
      origins: ["https://*.amazonaws.com"],
    },
  },
  namespaces: [
    defineNamespace({
      id: "awsSigv4",
      summary: "Calls AWS services with a signed GET request.",
      types: "",
      methods: { get: request },
    }),
  ],
});
