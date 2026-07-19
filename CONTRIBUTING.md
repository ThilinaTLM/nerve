# Contributing

Thanks for your interest in Nerve. The project is currently alpha, so small, focused changes are easiest to review.

## Development

```sh
pnpm install
pnpm fix
pnpm check
pnpm test
```

## Guidelines

- Keep changes scoped. Add automated tests for important behavior: public contracts, security and redaction, persistence and migrations, destructive operations, concurrency and state machines, recovery and failure handling, and complex parsing or orchestration.
- Do not add tests solely for static exports or constants, pass-through adapters or routes, cosmetic presentation, animation details, or behavior already covered at its owning layer.
- Prefer representative boundary cases over exhaustive permutations. Extend an existing relevant test file instead of adding another test worker when practical.
- Do not commit secrets, local data, build output, or machine-specific paths.
- Keep user-facing text and documentation concise.
- For security issues, follow `SECURITY.md` instead of opening a public issue.
