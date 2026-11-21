import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createFakeCredentialContext } from "@nervekit/extension-api/testing";
import * as api from "@nervekit/extension-api";
import { createContext, runInContext } from "node:vm";
import { buildExtension } from "../src/build.ts";
import { ExtensionProjectError } from "../src/problems.ts";

const examples = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "examples",
);

// The `get-vanilla` case of the AWS Signature Version 4 test suite.
const AWS_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const AWS_NOW = Date.UTC(2015, 7, 30, 12, 36, 0);

type Provider = {
  signIn(ctx: unknown): Promise<unknown>;
  refresh?(ctx: unknown): Promise<unknown>;
  apply(
    ctx: unknown,
  ):
    | Promise<{ headers?: Record<string, string> }>
    | { headers?: Record<string, string> };
};

/** Builds an example and evaluates its credentials bundle as the host's sandbox does, with a fixed clock. */
async function loadProvider(id: string, now?: number): Promise<Provider> {
  const root = await mkdtemp(join(tmpdir(), "nerve-cred-"));
  try {
    const folder = join(root, id);
    await cp(join(examples, id), folder, { recursive: true });
    const { distDir } = await buildExtension({ projectDir: folder });
    const bundle = await readFile(join(distDir, "credentials.js"), "utf8");
    const RealDate = Date;
    const FixedDate = class extends RealDate {
      constructor(...args: unknown[]) {
        super(...((args.length ? args : [now ?? RealDate.now()]) as [number]));
      }
      static override now() {
        return now ?? RealDate.now();
      }
    };
    const sandbox = createContext({
      __nerveExtensionApi: api,
      TextEncoder,
      Date: FixedDate,
    });
    runInContext(bundle, sandbox);
    return (sandbox as { __nerveCredentialProvider: Provider })
      .__nerveCredentialProvider;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test("SigV4 example: reproduces the AWS get-vanilla test vector", async () => {
  const provider = await loadProvider("aws-sigv4", AWS_NOW);
  const { apply } = createFakeCredentialContext({
    account: { fields: { region: "us-east-1", service: "service" } },
    secrets: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: AWS_SECRET },
    request: { url: "https://example.amazonaws.com/" },
  });
  const { headers } = await provider.apply(apply);
  assert.equal(headers?.["x-amz-date"], "20150830T123600Z");
  assert.equal(
    headers?.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
  );
});

void test("SigV4 example: query order does not change the signature; a session token is signed", async () => {
  const provider = await loadProvider("aws-sigv4", AWS_NOW);
  const sign = async (url: string, sessionToken?: string) =>
    (
      await provider.apply(
        createFakeCredentialContext({
          account: { fields: { region: "us-east-1", service: "service" } },
          secrets: {
            accessKeyId: "AKIDEXAMPLE",
            secretAccessKey: AWS_SECRET,
            ...(sessionToken ? { sessionToken } : {}),
          },
          request: { url },
        }).apply,
      )
    ).headers!;
  assert.equal(
    (await sign("https://example.amazonaws.com/?b=2&a=1")).authorization,
    (await sign("https://example.amazonaws.com/?a=1&b=2")).authorization,
  );
  const withToken = await sign("https://example.amazonaws.com/", "TOKEN");
  assert.equal(withToken["x-amz-security-token"], "TOKEN");
  assert.match(
    withToken.authorization!,
    /SignedHeaders=host;x-amz-date;x-amz-security-token,/,
  );
});

void test("SigV4 example: apply signs with the digest of the body the host computed", async () => {
  const provider = await loadProvider("aws-sigv4", AWS_NOW);
  const { apply } = createFakeCredentialContext({
    account: { fields: { region: "eu-west-1", service: "s3" } },
    secrets: { accessKeyId: "AKID", secretAccessKey: AWS_SECRET },
    request: {
      method: "PUT",
      url: "https://bucket.s3.eu-west-1.amazonaws.com/key",
      body: "hello",
    },
  });
  const { headers } = await provider.apply(apply);
  assert.equal(
    headers?.["x-amz-content-sha256"],
    createHash("sha256").update("hello").digest("hex"),
  );
  assert.match(
    headers?.authorization ?? "",
    /^AWS4-HMAC-SHA256 Credential=AKID\/20150830\/eu-west-1\/s3\/aws4_request/,
  );
  const { signIn } = createFakeCredentialContext({ secrets: {} });
  await assert.rejects(provider.signIn(signIn), /access key id/);
});

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

void test("GitHub App example: a verifiable RS256 JWT is exchanged for an installation token", async () => {
  const provider = await loadProvider("github-app", 1_700_000_000_000);
  const { signIn, record } = createFakeCredentialContext({
    account: { fields: { appId: "123", installationId: "456" } },
    secrets: { privateKey: pem },
    http: (request) => {
      const [header, payload, signature] = String(
        request.headers?.authorization,
      )
        .replace("Bearer ", "")
        .split(".");
      assert.deepEqual(
        JSON.parse(Buffer.from(header!, "base64url").toString()),
        {
          alg: "RS256",
          typ: "JWT",
        },
      );
      assert.ok(
        verify(
          "sha256",
          Buffer.from(`${header}.${payload}`),
          publicKey,
          Buffer.from(signature!, "base64url"),
        ),
      );
      assert.deepEqual(
        JSON.parse(Buffer.from(payload!, "base64url").toString()),
        {
          iat: 1_700_000_000 - 60,
          exp: 1_700_000_000 + 540,
          iss: "123",
        },
      );
      return {
        status: 201,
        ok: true,
        body: { token: "ghs_installation", expires_at: "2030-01-01T00:00:00Z" },
      };
    },
  });
  const result = await provider.signIn(signIn);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    state: { token: "ghs_installation" },
    expiresAt: "2030-01-01T00:00:00Z",
    identity: { installationId: "456" },
  });
  assert.equal(
    record.requests[0]?.url,
    "https://api.github.com/app/installations/456/access_tokens",
  );
  const { apply } = createFakeCredentialContext({
    state: { token: "ghs_installation" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await provider.apply(apply))), {
    headers: { authorization: "Bearer ghs_installation" },
  });
});

void test("GitHub App example: refresh needs sign-in when GitHub rejects the key, and throws when it cannot tell", async () => {
  const provider = await loadProvider("github-app");
  const context = (status: number) =>
    createFakeCredentialContext({
      account: { fields: { appId: "1", installationId: "2" } },
      secrets: { privateKey: pem },
      http: () => ({ status, ok: status < 300, body: { message: "no" } }),
    }).refresh;
  assert.deepEqual(
    JSON.parse(JSON.stringify(await provider.refresh!(context(401)))),
    {
      needsSignIn: true,
      message: "GitHub did not issue an installation token (HTTP 401).",
    },
  );
  await assert.rejects(
    provider.refresh!(context(503)),
    (error: unknown) => (error as { code?: string }).code === "SERVER_ERROR",
  );
});

async function inTemp<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "nerve-cred-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const id of ["aws-sigv4", "github-app"])
  void test(`${id} example builds into a manifest with its credentials`, async () => {
    await inTemp(async (root) => {
      const folder = join(root, id);
      await cp(join(examples, id), folder, { recursive: true });
      const { manifest, distDir } = await buildExtension({
        projectDir: folder,
      });
      const bundle = await readFile(join(distDir, "credentials.js"), "utf8");
      assert.equal(
        manifest.credentials?.sha256,
        createHash("sha256").update(bundle).digest("hex"),
      );
      assert.deepEqual(
        manifest.credentials?.operations.includes("apply"),
        true,
      );
      assert.match(bundle, /__nerveExtensionApi/);
      assert.doesNotMatch(bundle, /require\(["']@nervekit/);
      const written = JSON.parse(
        await readFile(join(distDir, "manifest.json"), "utf8"),
      );
      assert.deepEqual(written.credentials, manifest.credentials);
    });
  });

void test("a kind that names the extension provider needs src/credentials.ts, and the file needs such a kind", async () => {
  await inTemp(async (root) => {
    const folder = join(root, "aws-sigv4");
    await cp(join(examples, "aws-sigv4"), folder, { recursive: true });
    await rm(join(folder, "src", "credentials.ts"));
    await assert.rejects(
      buildExtension({ projectDir: folder }),
      (error: unknown) =>
        error instanceof ExtensionProjectError &&
        error.problems.some((problem) =>
          /credentials\.ts does not exist/.test(problem.what),
        ),
    );
    const orphan = join(root, "orphan");
    await mkdir(join(orphan, "src"), { recursive: true });
    await writeFile(
      join(orphan, "package.json"),
      '{"name":"orphan","version":"0.1.0"}',
    );
    await writeFile(
      join(orphan, "src", "extension.ts"),
      'import { defineExtension } from "@nervekit/extension-sdk";\nexport default defineExtension({ id: "orphan", name: "Orphan", description: "x", icon: "globe", enabledByDefault: false, settings: { version: 1, fields: {} }, namespaces: [] });\n',
    );
    await writeFile(
      join(orphan, "src", "credentials.ts"),
      'import { defineCredentialProvider } from "@nervekit/extension-sdk";\nexport default defineCredentialProvider({ signIn: async () => ({ state: 1 }), apply: () => ({}) });\n',
    );
    await assert.rejects(
      buildExtension({ projectDir: orphan }),
      (error: unknown) =>
        error instanceof ExtensionProjectError &&
        error.problems.some((problem) =>
          /no account kind names provider/.test(problem.what),
        ),
    );
  });
});
