# Agent-assisted development

This workflow is optional. The maintainer decides which steps earn their cost and remains responsible for scope, architecture, and review.

## Substantial features

Use this sequence when a feature changes behavior across several modules or introduces a durable design decision:

```text
spec
  ↓
optional grilling
  ↓
codebase-design or domain-modeling, when relevant
  ↓
ADR, when warranted
  ↓
improve → plans/*
  ↓
implementation and focused TDD
  ↓
code review
  ↓
sync durable docs
```

The steps mean:

1. Write a spec when behavior, scope, or acceptance criteria need agreement. The `to-spec` skill can synthesize the current discussion.
2. Use `grilling` when unresolved choices can change the design.
3. Use `codebase-design` for module interfaces and seams. Use `domain-modeling` when terms, relationships, or rules change.
4. Add an ADR only when a decision is costly to reverse, surprising without context, and based on a real tradeoff.
5. Use `improve` when another agent needs a self-contained execution plan under `plans/`.
6. Implement the smallest complete change. Use `tdd` for a bug with a cheap regression seam or when the maintainer asks for test-first work.
7. Review behavior, security, maintainability, and scope against the spec and plan.
8. Update the affected source of truth before calling the work complete.

Small fixes do not need this sequence. Diagnose the issue, make the focused change, run the nearest useful check, and update durable docs only when their claims changed.

## Local planning files

Keep disposable specs and tickets under `.scratch/<feature>/`. Git ignores `.scratch/`, so these files stay local.

Use these paths:

```text
.scratch/<feature>/spec.md
.scratch/<feature>/issues/01-<ticket>.md
.scratch/<feature>/issues/02-<ticket>.md
```

The `to-tickets` skill writes one vertical slice per issue file and records blocking relationships in each file. Work on any ticket whose blockers are complete.

`plans/` has a different job. The `improve` skill writes execution plans there for a fresh agent. Git ignores the directory. Plans are the maintainer's disposable copy and never override current code, `CONTEXT.md`, ADRs, or specs.

## Durable documentation

- Update `CONTEXT.md` when domain vocabulary or relationships change.
- Update the narrow document under `docs/architecture/` when an implemented responsibility, flow, state owner, or trust boundary changes.
- Add an ADR under `docs/adr/` only when the decision meets the ADR threshold.
- Keep behavioral requirements under `docs/specs/` and state whether each spec is proposed, gated, implemented, or superseded.
- Update `README.md` when setup, commands, prerequisites, or operator configuration change.
