# Small VM: Windows → Linux Ctrl+V paste diagnosis

A tiny, self-contained "VM" (a Docker container) that reproduces and explains
why **Ctrl+V paste from a Windows terminal to a Linux host (over SSH) misses**
in PrioriCode — while text usually still works.

## What it is

- The container is a **headless Linux "remote host"**: no X11/Wayland, no
  `xclip`/`wl-paste`/`xsel`, `SSH_TTY` set — i.e. a bare SSH host.
- It runs the **real** PrioriCode paste modules (`packages/tui/src/clipboard*`)
  under bun and simulates the **Windows terminal** in-process.
- It drives the exact `prompt.paste` decision (terminal protocol → host
  clipboard) and prints a matrix + root cause + the user-facing hint.

## Run it

```sh
bash vm/run.sh            # build + run the VM (needs Docker)
bun vm/diagnose.ts        # same diagnosis, no Docker (needs bun)
```

## What it shows

| terminal         | image result                           |
|------------------|----------------------------------------|
| windows-terminal | **miss** ← the bug                     |
| kitty            | protocol (kitty OSC 5522)              |
| any              | text → bracketed paste (terminal-native)|

**Root cause:** the clipboard lives on the Windows client. Windows Terminal
implements neither the kitty clipboard protocol (OSC 5522) nor OSC 52
*read/query* (only write), so the terminal-protocol channel gets no answer; and
the host clipboard needs a display server a headless remote lacks. Text still
works via the terminal's own bracketed paste.

**Fixes (any one):** use a terminal that answers the kitty protocol
(kitty/ghostty/wezterm) · use the PrioriCode VS Code extension · copy the file
to the host and paste its path.
