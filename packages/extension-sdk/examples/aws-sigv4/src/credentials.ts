import {
  defineCredentialProvider,
  ExtensionError,
} from "@nervekit/extension-sdk";
import { EMPTY_PAYLOAD_HASH, hex, sigv4Headers } from "./sigv4";

export default defineCredentialProvider({
  // The access key is typed in, so signing in only checks that it is complete.
  async signIn({ secrets, account }) {
    if (!secrets.accessKeyId || !secrets.secretAccessKey)
      throw new ExtensionError(
        "BAD_REQUEST",
        "Enter the access key id and the secret access key.",
      );
    return {
      state: {},
      identity: {
        region: String(account.fields.region ?? "us-east-1"),
      },
    };
  },

  async apply({ request, secrets, account, crypto }) {
    const service = String(account.fields.service ?? "s3");
    const payloadHash = request.body
      ? hex(await request.body.digest("sha256"))
      : EMPTY_PAYLOAD_HASH;
    return {
      headers: await sigv4Headers(
        {
          method: request.method,
          host: request.host,
          path: request.path,
          query: request.query,
          headers: request.headers,
          payloadHash,
          region: String(account.fields.region ?? "us-east-1"),
          service,
          accessKeyId: secrets.accessKeyId ?? "",
          secretAccessKey: secrets.secretAccessKey ?? "",
          ...(secrets.sessionToken
            ? { sessionToken: secrets.sessionToken }
            : {}),
          contentSha256Header: service === "s3",
        },
        crypto,
      ),
    };
  },
});
