fmt:
  mise exec -- bunx ultracite fix

lint:
  mise exec -- bunx ultracite check

typecheck:
  mise exec -- bun run typecheck

test:
  mise exec -- bun run test

check: lint typecheck test

build:
  mise exec -- bun run build

check-packages: build
  mise exec -- bun run check:packages
