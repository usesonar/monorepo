fmt:
  bunx ultracite fix

lint:
  bunx ultracite check

typecheck:
  bun run typecheck

test:
  bun run test

check: lint typecheck test

build:
  bun run build

check-packages: build
  bun run check:packages
