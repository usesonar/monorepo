# Changesets

Add one changeset for every pull request that changes a publishable package:

```sh
bun changeset
```

Choose `@usesonar/eve`, `@usesonar/react`, or both, then describe the public change. The packages version independently. Changes to the private root workspace or `apps/next` do not need a package release.

Feature work lands on `staging`. A merge from `staging` to `main` runs the direct release workflow: pending changesets are consumed into a version commit, and any package version missing from npm is published. There is no Changesets version pull request.
