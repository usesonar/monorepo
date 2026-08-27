import { afterAll, describe, expect, it } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import * as ReactPackage from "../src/index"

const execFileAsync = promisify(execFile)
const packageRoot = path.dirname(import.meta.dirname)
const repositoryRoot = path.dirname(path.dirname(packageRoot))
const packDirectory = await mkdtemp(path.join(tmpdir(), "usesonar-react-pack-"))
// npm pack starts external npm and tar processes, which can queue behind the
// other package suites during a whole-workspace run without indicating a failure.
const packageVerificationTimeout = 20_000
const exactSemver =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?(?:\+[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)?$/u

afterAll(() => rm(packDirectory, { force: true, recursive: true }))

const productionSources = async () => {
  const sourceRoot = path.join(packageRoot, "src")
  const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true })
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) && !entry.name.includes(".test.")
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
  return Promise.all(
    files.map(async (filePath) => ({ path: filePath, source: await readFile(filePath, "utf-8") }))
  )
}

describe("React package boundary", () => {
  it("exports only the intended runtime surface", () => {
    expect(Object.keys(ReactPackage).toSorted()).toEqual([
      "SonarProvider",
      "useDeepSonar",
      "useSonar",
    ])
  })

  it("exports the intentional public result and provider types", async () => {
    const sources = await productionSources()
    const publicIndex = sources.find(({ path: filePath }) => filePath.endsWith("/src/index.ts"))
    expect(publicIndex?.source).toMatch(/SonarProviderProps/u)
    expect(publicIndex?.source).toMatch(/SonarResult/u)
  })

  it(
    "pins the locked React and TanStack versions",
    async () => {
      const packageSource = await readFile(path.join(packageRoot, "package.json"), "utf-8")
      const packageJSON = JSON.parse(packageSource)
      const packageName: string = packageJSON.name
      const packageVersion: string = packageJSON.version
      const effectVersion: string = packageJSON.dependencies?.["@usesonar/effect"]

      expect(packageJSON.dependencies?.["@tanstack/react-query"]).toBe("5.102.6")
      expect(packageJSON.peerDependencies?.react).toBe("19.2.8")
      expect(packageJSON.devDependencies?.react).toBe("19.2.8")
      expect(packageJSON.devDependencies?.["react-dom"]).toBe("19.2.8")
      expect(effectVersion).toMatch(exactSemver)
      expect(effectVersion).not.toContain("workspace:")

      await execFileAsync("npm", [
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        packDirectory,
        packageRoot,
      ])
      const tarballName = `${packageName.replace(/^@/u, "").replace("/", "-")}-${packageVersion}.tgz`
      const tarball = path.join(packDirectory, tarballName)
      const { stdout: packedManifestSource } = await execFileAsync("tar", [
        "-xOf",
        tarball,
        "package/package.json",
      ])
      const packedManifest = JSON.parse(packedManifestSource)
      expect(packedManifest.dependencies?.["@usesonar/effect"]).toBe(effectVersion)
      expect(packedManifestSource).not.toContain("workspace:")
    },
    packageVerificationTimeout
  )

  it("uses the streamed-query adapter through public package roots", async () => {
    const sources = await productionSources()
    const combined = sources.map(({ source }) => source).join("\n")

    expect(combined).toContain("experimental_streamedQuery")
    expect(combined).toContain('from "@tanstack/react-query"')
    expect(combined).toContain('from "@usesonar/effect"')
    expect(combined).not.toMatch(/@usesonar\/(?:api|backend)/u)
    expect(combined).not.toMatch(/packages\/(?:api|backend|effect)\/src/u)
  })

  it("contains no transport or provider implementation", async () => {
    const sources = await productionSources()
    const combined = sources.map(({ source }) => source).join("\n")
    const forbidden = [
      /from ["']ky["']/u,
      /EventSource/u,
      /globalThis\.fetch/u,
      /\bfetch\s*\(/u,
      /sixtyfour/iu,
      /firecrawl/iu,
      /exa\b/iu,
      /provider.*jobId/iu,
    ]

    for (const pattern of forbidden) {
      expect(combined).not.toMatch(pattern)
    }
  })

  it("keeps every verifier active", async () => {
    const roots = [path.join(packageRoot, "src"), path.join(packageRoot, "test")]
    const filesByRoot = await Promise.all(
      roots.map(async (root) => {
        const entries = await readdir(root, {
          recursive: true,
          withFileTypes: true,
        })
        return entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
          .map((entry) => path.join(entry.parentPath, entry.name))
      })
    )
    const sources = await Promise.all(filesByRoot.flat().map((file) => readFile(file, "utf-8")))
    const combined = sources.join("\n")

    expect(combined).not.toMatch(/\.(?:only|skip|todo)\s*\(/u)
  })

  it("does not track generated dist output", async () => {
    const { stdout } = await execFileAsync("git", ["ls-files", "--", "packages/react/dist"], {
      cwd: repositoryRoot,
    })
    expect(stdout.trim()).toBe("")
  })
})
