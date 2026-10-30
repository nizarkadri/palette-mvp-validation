# Commit Naming Guide

Use this naming style if making real git commits from the micro-commit plan.

## Format

```txt
phase NN.MM: short imperative summary
```

Examples:

```txt
phase 01.01: add element normalization helper
phase 02.02: make AI prompt exhaustive
phase 04.03: add role lock toggle handler
phase 06.04: add remove control for kanban items
```

## Guidelines

- Keep commits small enough to review quickly.
- Do not mix phases in one commit unless necessary.
- Run validation after each phase, not necessarily after every tiny commit.
- Update `micro commit tracker.md` as commits land.

## Validation Commit Example

```txt
phase 06: validate kanban element controls
```

Use a phase-level validation commit only when it contains test fixes, build fixes, or documentation updates related to that phase.
