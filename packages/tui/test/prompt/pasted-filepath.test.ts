import { expect, test } from "bun:test"
import { pastedFilepath } from "../../src/component/prompt/pasted-filepath"

test("win32: multi-quoted Explorer/cmd paste takes the first path", () => {
  expect(pastedFilepath('"C:\\shots\\a.png" "C:\\shots\\b.png"', "win32")).toBe("C:\\shots\\a.png")
  expect(pastedFilepath('"C:\\shots\\a.png"', "win32")).toBe("C:\\shots\\a.png")
  expect(pastedFilepath("C:\\shots\\a.png", "win32")).toBe("C:\\shots\\a.png")
  expect(pastedFilepath("\\\\server\\share\\a.png", "win32")).toBe("\\\\server\\share\\a.png")
})

test("win32: prose is not probed against the filesystem", () => {
  expect(pastedFilepath('"note to self"', "win32")).toBeUndefined()
  expect(pastedFilepath("hello world", "win32")).toBeUndefined()
})

test("file:// urls resolve to local paths on every platform", () => {
  expect(pastedFilepath("file:///home/u/shot.png", "linux")).toBe("/home/u/shot.png")
  expect(pastedFilepath("file:///C:/shots/a.png", "win32")).toBe("C:\\shots\\a.png")
  expect(pastedFilepath('"file:///home/u/a%20b.png"', "linux")).toBe("/home/u/a b.png")
})

test("https urls are left as text", () => {
  expect(pastedFilepath("https://example.com/a.png", "linux")).toBeUndefined()
  expect(pastedFilepath("http://example.com/a.png", "win32")).toBeUndefined()
})

test("linux: POSIX terminal escaping is unescaped, Windows shapes are left intact", () => {
  expect(pastedFilepath("/home/u/my\\ photo.png", "linux")).toBe("/home/u/my photo.png")
  expect(pastedFilepath("./dir/image.png", "linux")).toBe("./dir/image.png")
  expect(pastedFilepath("~/pics/a.png", "linux")).toBe("~/pics/a.png")
  // Defense-in-depth after the WSL file:// translation: a raw C:\ path that
  // still arrives as text must not be backslash-mangled into nonsense.
  expect(pastedFilepath("C:\\shots\\a.png", "linux")).toBe("C:\\shots\\a.png")
})

test("linux: prose never reaches the filesystem", () => {
  expect(pastedFilepath("please fix the tests", "linux")).toBeUndefined()
  expect(pastedFilepath("halo dunia", "linux")).toBeUndefined()
})

test("multi-line paste only inspects the first line", () => {
  expect(pastedFilepath("/tmp/a.png\ntrailing explanation", "linux")).toBe("/tmp/a.png")
})
