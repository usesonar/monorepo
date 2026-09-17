import { expect, test } from "bun:test"

// Three package builds plus a pinned compiler run need headroom under whole-workspace contention.
const compilerSubprocessTimeout = 60_000

test(
  "preserves dynamic callback inference under the repository's locked TypeScript 5 probe",
  async () => {
    const repository = new URL("../../..", import.meta.url).pathname
    await Promise.all(
      ["@usesonar/api", "@usesonar/effect", "@usesonar/eve"].map(async (packageName) => {
        const build = Bun.spawn(["bun", "run", "--filter", packageName, "build"], {
          cwd: repository,
          stderr: "pipe",
          stdout: "pipe",
        })
        const [buildExitCode, buildError] = await Promise.all([
          build.exited,
          new Response(build.stderr).text(),
        ])
        expect(buildError).not.toContain("error")
        expect(buildExitCode).toBe(0)
      })
    )
    const project = new URL("typescript5/tsconfig.json", import.meta.url).pathname
    const child = Bun.spawn(["bunx", "--package", "typescript@5.9.3", "tsc", "-p", project], {
      stderr: "pipe",
      stdout: "pipe",
    })
    const [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ])

    expect(`${stdout}${stderr}`).not.toContain("error TS")
    expect(exitCode).toBe(0)
  },
  compilerSubprocessTimeout
)
