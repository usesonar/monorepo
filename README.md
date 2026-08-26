# Sonar

This is the Sonar monorepo. The workspace is organized around:

- `packages/eve`
- `packages/react`
- `apps/next`

The product handoff lives in [SPEC.md](./SPEC.md). The workspace is only a scaffold for now; these surfaces are not implemented yet.

```sh
bun install
just fmt
just check
just build
```

## Releases

`@usesonar/eve` and `@usesonar/react` are independently versioned public packages. Add one changeset for each publishable change with `bun changeset`, land feature work on `staging`, then merge `staging` to `main`. A push to `main` directly versions and publishes missing package versions; it does not maintain a version pull request.

The first `0.0.0` publication is a manual bootstrap so npm can reserve both package names. After that bootstrap, configure an npm trusted publisher on each package for the GitHub organization `usesonar`, repository `monorepo`, and workflow file `release.yml`. The repository is private, so package provenance is explicitly disabled even though publishing uses short-lived OIDC credentials.
