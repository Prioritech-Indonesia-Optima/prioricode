// Spawn a command under a real PTY via util-linux `script`, with raw pipe
// access to its input/output byte streams.
export function spawnPty(command: string, env?: Record<string, string>) {
  return Bun.spawn(["script", "-q", "-e", "-c", command, "/dev/null"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, ...(env ?? {}) },
  })
}
