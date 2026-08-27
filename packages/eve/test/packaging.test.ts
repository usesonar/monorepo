/* eslint-disable anti-slop/no-runtime-typeof -- npm pack emits untrusted JSON that this verifier checks before reading. */
import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "usesonar-eve-pack-"))
// Whole-workspace tests contend with other package builds; npm pack still gets a bounded deadline.
const packageSubprocessTimeout = 30_000

afterAll(() => rm(temporaryDirectory, { force: true, recursive: true }))

test(
  "packs a publishable manifest with no workspace protocol",
  async () => {
    const packageDirectory = new URL("..", import.meta.url).pathname
    const sourceManifest: unknown = await Bun.file(
      path.join(packageDirectory, "package.json")
    ).json()
    if (
      typeof sourceManifest !== "object" ||
      sourceManifest === null ||
      !("name" in sourceManifest) ||
      typeof sourceManifest.name !== "string" ||
      !("version" in sourceManifest) ||
      typeof sourceManifest.version !== "string" ||
      !("dependencies" in sourceManifest)
    ) {
      throw new TypeError("Expected source package metadata")
    }
    const packed = Bun.spawn(
      [
        "npm",
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        temporaryDirectory,
        packageDirectory,
      ],
      { stderr: "pipe", stdout: "pipe" }
    )
    const [packExitCode, packOutput, packError] = await Promise.all([
      packed.exited,
      new Response(packed.stdout).text(),
      new Response(packed.stderr).text(),
    ])
    expect(packError).toBe("")
    expect(packExitCode).toBe(0)

    const report: unknown = JSON.parse(packOutput)
    if (
      !Array.isArray(report) ||
      typeof report[0]?.filename !== "string" ||
      report[0].name !== sourceManifest.name ||
      report[0].version !== sourceManifest.version
    ) {
      throw new TypeError("npm pack returned no tarball filename")
    }
    const tarball = path.join(temporaryDirectory, report[0].filename)
    const extracted = Bun.spawn(["tar", "-xOf", tarball, "package/package.json"], {
      stderr: "pipe",
      stdout: "pipe",
    })
    const [extractExitCode, manifestText, extractError] = await Promise.all([
      extracted.exited,
      new Response(extracted.stdout).text(),
      new Response(extracted.stderr).text(),
    ])
    expect(extractError).toBe("")
    expect(extractExitCode).toBe(0)
    expect(manifestText).not.toContain("workspace:")
    expect(JSON.parse(manifestText)).toMatchObject({
      dependencies: sourceManifest.dependencies,
      name: sourceManifest.name,
      version: sourceManifest.version,
    })
  },
  packageSubprocessTimeout
)
