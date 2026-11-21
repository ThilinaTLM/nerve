# AWS access key (SigV4)

An account kind whose requests are signed with AWS Signature Version 4: the access key id and
secret are typed-in secrets, and `src/credentials.ts` signs every request in `apply`. The
extension's backend only calls `ctx.http.request({ auth: { account: "account" } })`; it never sees
the keys or the signature.

- `src/sigv4.ts` is a small self-contained SigV4 signer over `ctx.crypto` (`hash`, `hmac`) and the
  request body's `digest("sha256")`, which the host computes, also for streamed uploads.
- `src/credentials.ts` is the provider: `signIn` checks the secrets, `apply` returns the
  `Authorization`, `X-Amz-Date`, `X-Amz-Security-Token` and `X-Amz-Content-Sha256` headers.

The signer is tested in `packages/extension-sdk/test/credential-examples.test.ts` against the
AWS SigV4 test suite vector `get-vanilla`.
