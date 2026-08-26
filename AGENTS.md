# Working in Sonar

This repository is a Bun workspace. Use `just` as the command surface, inspect `git status` before editing, and preserve concurrent work you did not author.

## TypeScript

- Keep TypeScript strict, including `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- Use `@/` for app-local source imports and `@usesonar/*` for exported package surfaces.
- Prefer type aliases. A Zod schema value and its inferred type may share a PascalCase name: `const User = z.object(...)` and `type User = z.infer<typeof User>`.
- Infer result shapes owned by libraries. Normalize external values once at the boundary instead of spreading uncertain types through the codebase.
- Avoid forwarding wrappers and module-level singletons. Use implicit-return arrow functions for single expressions.
- Keep acronyms uppercase in identifiers (`API`, `URL`, `JSON`), except for the conventional `Id` suffix (`userId`, `UserId`).

## Quality

Treat Ultracite anti-slop diagnostics as design feedback. Do not disable a rule unless a concrete invariant makes the flagged construct necessary. Type assertions require a nearby `SAFETY:` comment explaining that invariant.

Put Bun tests beside the code as `*.test.ts` and run `bun test`. Before handing off changes, run `just fmt` and then `just check`. When adding a workspace, add it to the TypeScript project references as well.
