import { createHash } from "node:crypto"

type CanonicalValue =
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue }

type CanonicalEntry = readonly [string, CanonicalValue]

const canonicalObject = (entries: readonly CanonicalEntry[]) =>
  // SAFETY: Object.fromEntries preserves the string-keyed CanonicalValue entries supplied below.
  Object.fromEntries(
    entries.toSorted(([left], [right]) => left.localeCompare(right))
  ) as CanonicalValue

if (Bun.env.SONAR_STACK_FINGERPRINT_MODE !== "1") {
  throw new Error("stack fingerprint helper requires SONAR_STACK_FINGERPRINT_MODE=1")
}

const fixture = canonicalObject([
  [
    "config",
    canonicalObject([
      ["company", ["name"]],
      ["person", ["title"]],
      [
        "research",
        canonicalObject([["sellsToSMB", "Does this company sell to small and medium businesses?"]]),
      ],
      ["ttl", "12h"],
    ]),
  ],
  ["route", "/v1/research"],
  [
    "seed",
    canonicalObject([
      ["fullName", "Ada Lovelace"],
      ["xURL", "https://x.com/ada"],
    ]),
  ],
  ["tenantId", "tenant-stack"],
])

const fingerprint = createHash("sha256").update(JSON.stringify(fixture)).digest("hex")

process.stdout.write(JSON.stringify({ fingerprint }))
