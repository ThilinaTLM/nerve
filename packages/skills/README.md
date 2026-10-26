# `@nervekit/skills`

Official prompt-skill content bundled with Nerve.

- `src/builtin/`: catalog skills shown in settings and available-skill prompts.
- `src/guides/`: tool-group guides, excluded from the toggleable catalog.
- `src/catalog.ts`: validated immutable catalog loader.
- `src/paths.ts`: `builtinSkillFilePath(name)` resolves bundled skills/guides beside the installed module; `resolveSkillPlaceholders(text)` expands `{{skill:name}}`, preserving unknown names.
- `test/`: catalog integrity, guide isolation, and path resolution behavior.

Generic skill parsing and prompt formatting belong to `@nervekit/harness`. Executable capabilities, permission policy, and dispatch belong to `@nervekit/tools`. This package contains only official skill content and its catalog lifecycle.
