# Changesets

Add one changeset for every pull request that changes a publishable package:

```sh
bun changeset
```

Choose any affected package from `@usesonar/api`, `@usesonar/effect`, `@usesonar/react`, and `@usesonar/eve`, then describe the public change. The packages version independently unless a dependency update requires a coordinated release.

`@usesonar/backend` is private and must not appear in a changeset or release loop. Changes limited to the private root workspace, `packages/backend`, or `apps/next` do not need a package release; use `bun changeset --empty` only when the pull-request gate still requires a changeset.

Feature work lands on `staging`. A merge from `staging` to `main` runs the direct release workflow: pending changesets are consumed into release bookkeeping, each affected package and any dependency-required bump is versioned, and each missing non-bootstrap public package version is published. An empty changeset is consumed without bumping a package. There is no Changesets version pull request.

Before the first automated release, manually publish each still-unpublished `0.0.0` package to reserve its npm name. Then configure an npm trusted publisher for the GitHub organization `usesonar`, repository `monorepo`, and workflow `release.yml`. The automated workflow rejects unpublished `0.0.0` packages.
