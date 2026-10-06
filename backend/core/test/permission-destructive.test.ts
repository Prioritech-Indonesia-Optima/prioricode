import { describe, expect, test } from "bun:test"
import { DestructiveCommand } from "@prioricode/core/permission/destructive"

describe("DestructiveCommand.isDestructive", () => {
  const destructive = [
    "rm -rf /",
    "rm -rf / ",
    "rm -rf /*",
    "rm -rf ~",
    "rm -rf $HOME",
    "rm -rf *",
    "rm -rf .",
    "rm -fr /",
    "rm -r -f /",
    "rm --recursive --force /",
    "sudo rm -rf /",
    "sudo -E rm -rf /",
    "mkfs /dev/sda",
    "mkfs.ext4 /dev/sda1",
    "fdisk /dev/sda",
    "parted /dev/sda mklabel gpt",
    "sgdisk --clear /dev/sda",
    "wipefs -a /dev/sda",
    "dd if=/dev/zero of=/dev/sda",
    "dd if=image.iso of=/dev/nvme0n1",
    "> /dev/sda",
    "echo done > /dev/sda",
    ": > /dev/nvme0n1",
    "shutdown now",
    "shutdown -h now",
    "reboot",
    "halt",
    "poweroff",
    "init 0",
    "init 6",
    "systemctl poweroff",
    "systemctl reboot",
    ":(){ :|:& };:",
    "chmod -R 777 /",
    "chown -R root:root /",
    "find / -delete",
    "cd / && rm -rf /",
    "true; rm -rf ~",
  ]

  for (const command of destructive) {
    test(`flags ${JSON.stringify(command)}`, () => {
      expect(DestructiveCommand.isDestructive(command)).toBe(true)
    })
  }

  const harmless = [
    "rm file.txt",
    "rm -rf build",
    "rm -rf ./node_modules",
    "rm -rf /tmp/foo",
    "rm -rf /usr/local/lib",
    "rm -rf dist",
    "ls -la",
    "git status",
    "git push",
    "npm install",
    "bun run build",
    "dd if=a.txt of=b.txt",
    "cat /dev/sda",
    "echo hi > out.txt",
    "echo hi >> notes.md",
    "chmod 644 file.txt",
    "find . -name '*.ts'",
    "find src -delete",
    "systemctl status nginx",
    "init",
  ]

  for (const command of harmless) {
    test(`ignores ${JSON.stringify(command)}`, () => {
      expect(DestructiveCommand.isDestructive(command)).toBe(false)
    })
  }
})
