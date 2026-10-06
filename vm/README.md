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

| terminal / setting  | image result                             |
| ------------------- | ---------------------------------------- |
| any, default        | **instant miss note** (no probe stall)   |
| kitty, `+OSC reads` | protocol (kitty OSC 5522) — opt-in       |
| any                 | text → bracketed paste (terminal-native) |

**Root cause:** remote clipboards live on the client. Only a kitty-protocol
terminal can carry image bytes over the pty (VS Code's terminal and Windows
Terminal can't answer clipboard reads), and a headless remote has no host
clipboard — so remote image fetching is now **off by default** with an instant
note; "Enable OSC clipboard image reads" opts the protocol back in.

**Fixes (any one):** use a terminal that answers the kitty protocol
(kitty/ghostty/wezterm) · use the PrioriCode VS Code extension · copy the file
to the host and paste its path. Whatever channel carries the bytes, they now
land as a **private file** (`<state>/paste`, `0700`/`0600`, TTL-pruned) and the
prompt attaches that path — the same uniform result locally and remotely.
