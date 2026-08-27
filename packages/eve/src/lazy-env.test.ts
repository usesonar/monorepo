import { expect, test } from "bun:test"

test("imports and executes an injected Layer in a fresh process without environment access", async () => {
  const child = Bun.spawn(
    [process.execPath, new URL("../test/lazy-env-child.ts", import.meta.url).pathname],
    {
      env: process.env,
      stderr: "pipe",
      stdout: "pipe",
    }
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  expect(stderr).toBe("")
  expect(exitCode).toBe(0)
  expect(JSON.parse(stdout)).toEqual({ networkCalls: 0, reads: [] })
})
