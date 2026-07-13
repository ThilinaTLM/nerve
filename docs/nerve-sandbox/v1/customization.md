# Customization

Customize a sandbox through validated configuration and image inputs:

- choose built-in or custom model catalog entries and credential references;
- select tool groups and approval/network/filesystem policy;
- mount project `AGENTS.md` context and `.agents/skills` resources;
- configure ordered boot phases for project dependencies;
- configure Git identity, GitHub host, and credential references;
- build a derived image that preserves `/agent` immutability, the non-root user, entrypoint, healthcheck, and `/workspace`/`/state` contracts.

Customization does not bypass catalog operations, tool policy, secret boundaries, or state versions. Skills and context influence prompts but grant no authority. Boot networking is the intersection of boot and global security policy.
