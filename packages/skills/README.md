# `@nervekit/skills`

Official prompt-skill content bundled with Nerve.

- `src/builtin/`: source `SKILL.md` directories.
- `src/catalog.ts`: validated immutable catalog loader.
- `test/`: catalog integrity and loading behavior.

Generic skill parsing and prompt formatting belong to `@nervekit/harness`. Executable capabilities, permission policy, and dispatch belong to `@nervekit/tools`. This package contains only official skill content and its catalog lifecycle.
