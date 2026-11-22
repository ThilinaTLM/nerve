# GitHub App installation

An account kind that signs in as a GitHub App installation: the app id and installation id are
account fields, the app's private key a typed-in secret. `src/credentials.ts` turns the key into
an RS256 JWT (`ctx.crypto.sign`), exchanges it for an installation token with `ctx.http`
(limited to `signInOrigins`) and hands the token to requests as a bearer token in `apply`. The
token lasts an hour, so the same exchange runs in `refresh` before it expires. The backend never
sees the key, the JWT or the token.
