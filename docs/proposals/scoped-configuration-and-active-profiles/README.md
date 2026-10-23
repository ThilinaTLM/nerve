# Scoped configuration and active agent profiles

> **Status:** Design in progress. Approved decisions and proposed details are explicitly distinguished. No database schema or migration implementation is authorized yet.

Establish one understandable configuration model across agent settings, harness behavior, permissions, suggestions, application preferences and reusable resources. Replace destructive profile application with temporary profile contributions that preserve explicit choices.

This follows [System prompt, tool descriptions, and agent profiles](../system-prompt-and-agent-profiles.md). Its materialized-template design is the implemented baseline; this proposal is a new design.

## Documents

- [Configuration model](configuration-model.md): approved roots, precedence, profile modes, merge rules and sub-agent boundaries.
- [Domain inventory](domain-inventory.md): current implementation and remaining domain decisions.
- [Schema specification](schemas.md): schema contracts, document boundaries and unresolved field definitions.
- [Migration and recovery](migration-and-recovery.md): versioning, startup migration, invalid files, safe recovery and write reliability.
- [Implementation readiness](implementation-readiness.md): decisions and acceptance scenarios required before implementation.

## Reading rules

Approved requirements are commitments. Proposed mechanisms and illustrative shapes are not final schemas. Open questions must be resolved rather than guessed during implementation. Agreement on a directory root does not authorize moving every catalog or runtime artifact into it.

## Validation

This is documentation-only work: review diffs and links, without running code validation or migration rehearsals. Database changes require separate explicit approval after discussing alternatives.
