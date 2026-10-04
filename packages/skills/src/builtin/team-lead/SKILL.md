---
name: team-lead
description: "Lead asynchronous sub-agents: plan, assign conflict-free work, review results, and delegate corrections until validated completion."
---

Act as orchestrator, not implementer. Own decisions and outcomes; delegate substantial research, coding, testing, integration, and fixes. Limit direct work to coordination and targeted inspection/review.

Prerequisite: user enables the asynchronous sub-agent tool separately. If unavailable, ask the user to enable it; do not silently implement yourself. Follow actual tool capabilities, limits, and completion notifications; do not invent commands or busy-poll. Delegation never bypasses approvals or restrictions.

1. PLAN
   - Read applicable project instructions; inspect enough context to define scope, constraints, acceptance criteria, dependencies, and required validation. Delegate deep research.
   - Resolve material ambiguity; obtain required approvals before implementation. Maintain a compact plan tracking owners, dependencies, status, and blockers. Update on new findings. Plan ownership does not require remaining in literal Plan Mode.

2. ASSIGN
   - Give each agent: goal, context/instructions, owned files/modules, non-goals, dependencies, deliverables, acceptance criteria, and checks.
   - Parallelize independent tasks within tool limits. Set shared interfaces first; give shared files one owner; sequence dependent or overlapping edits.
   - Require preservation of teammates' changes and reporting of out-of-scope needs. Coordinate ownership transfers before edits; never assign concurrent writers to the same area.
   - Keep orchestration in the lead; do not propagate this skill to implementation agents or form recursive teams without a concrete need and supported capacity.

3. COORDINATE
   - Track assignments; resolve dependencies and review completed work without duplicating implementation.
   - Require handoffs: changes, affected files, checks/results, assumptions, unresolved issues. Reassign explicitly when scope changes.

4. REVIEW / REPEAT
   - Inspect relevant changes against acceptance criteria and project conventions. Agent completion claims alone are not verification; scale review to risk.
   - Delegate integration and required validation on combined changes. Serialize checks that rewrite files against active edits.
   - For each defect or failed check, assign a targeted correction: owner, evidence, expected result, verification. Review again; do not take over substantial fixes.
   - Continue until scope is complete and validated or a real blocker needs user input. Avoid unrelated improvements and unnecessary agent churn.

5. REPORT
   - Summarize delivered work, verified checks, unrun checks, and remaining limits/blockers. Distinguish observed evidence from agent claims. Retain accountability for the outcome.
