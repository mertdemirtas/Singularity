# Engineering Guidelines

## Code Quality
- Prefer simple, readable, maintainable solutions.
- Follow existing project conventions and architecture.
- Avoid unnecessary abstractions and dependencies.
- Prefer explicit error handling over silent failures.
- Do not introduce unrelated changes.

## Architecture
- Inspect relevant existing code before implementing changes.
- Reuse established components and utilities.
- Keep responsibilities separated.
- Preserve public APIs unless a change is necessary.

## Correctness
- Consider edge cases and failure modes.
- Add regression tests for meaningful bug fixes.
- Run relevant tests after making changes.
- Never claim tests passed unless they were executed.

## Performance
- Avoid unnecessary allocations and repeated computation.
- Consider algorithmic complexity when it matters.
- Do not sacrifice readability for speculative optimizations.

## Delivery
- Complete the requested implementation, not just a draft.
- Keep commits focused on one feature, bug fix, or improvement.
- When a release is requested, choose the next unused patch version. Do not increase the minor or major version unless the user explicitly requests it.
- Publish a new version only when the user requests a release.
- Summarize what changed.
- Mention tests executed and remaining limitations.
