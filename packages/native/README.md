# `@nervekit/native`

Normalized TypeScript façades over one N-API Rust crate.

- `src/binding/`: private loading and raw binding contract.
- `src/git/`: typed Git client and contracts.
- `src/process/`: managed process and child-process façades.
- `native/src/api/`: N-API DTO boundary.
- `native/src/git`, `process`, `platform`, `runtime`: Rust domain, OS, and execution internals.

Consumers import only the normalized root API. Raw bindings and prebuild paths remain private.
