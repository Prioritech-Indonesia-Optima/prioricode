import { describe, expect, test } from "bun:test"
import { CommandArity } from "@prioricode/core/permission/arity"

describe("CommandArity", () => {
  test("reduces each simple command to its dictionary prefix pattern", () => {
    expect(CommandArity.patterns("git push origin main")).toEqual(["git push *"])
    expect(CommandArity.patterns("bun test src/foo.test.ts --timeout 10")).toEqual(["bun test *"])
    expect(CommandArity.patterns("npm run dev")).toEqual(["npm run dev *"])
    expect(CommandArity.patterns("terraform plan")).toEqual(["terraform plan *"])
    expect(CommandArity.patterns("customtool --flag arg")).toEqual(["customtool *"])
  })

  test("splits compound commands and keeps one pattern per simple command", () => {
    expect(CommandArity.patterns("make build && make test")).toEqual(["make build *", "make test *"])
    expect(CommandArity.patterns("ls | grep files; echo done")).toEqual(["ls *", "grep *", "echo *"])
  })

  test("strips common privilege wrappers so approvals bind the real program", () => {
    expect(CommandArity.patterns("sudo rm -rf build")).toEqual(["rm *"])
    expect(CommandArity.patterns("env PATH=/usr/bin node script.js")).toEqual(["node *"])
  })

  test("quotes do not split tokens and empty commands yield no patterns", () => {
    expect(CommandArity.patterns('echo "a && b"')).toEqual(["echo *"])
    expect(CommandArity.patterns("   ")).toEqual([])
  })
})
