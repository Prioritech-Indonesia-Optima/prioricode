// OpenTUI-compatible binding lookup (census Layer C: plugins call
// `createBindingLookup` from @opentui/keymap/extras and pass
// `lookup.gather(namespace, commands)` into keymap layers). Contract captured
// from @opentui/keymap 0.4.5: entries are `{ key, cmd }` pairs, one per key,
// array values expanded in order, `false` values skipped, command order kept.

export type BindingValue = string | string[] | false
export type BindingConfig = Readonly<Record<string, BindingValue>>

export type BindingEntry = Readonly<{ key: string; cmd: string }>

export interface BindingLookup {
  gather(namespace: string, commands: readonly string[]): BindingEntry[]
  has(command: string): boolean
  get(command: string): BindingEntry[]
  readonly config: BindingConfig
}

export function createBindingLookup(config: BindingConfig): BindingLookup {
  return {
    config,
    gather(_namespace, commands) {
      const entries: BindingEntry[] = []
      for (const cmd of commands) entries.push(...lookupEntries(config, cmd))
      return entries
    },
    has(command) {
      return config[command] !== undefined && config[command] !== false
    },
    get(command) {
      return lookupEntries(config, command)
    },
  }
}

function lookupEntries(config: BindingConfig, cmd: string): BindingEntry[] {
  const value = config[cmd]
  if (value === undefined || value === false) return []
  // OpenTUI expands array values into one entry per key but treats a string
  // value (even a comma chain like "enter,return") as a single key entry.
  const keys = Array.isArray(value) ? value : [value]
  return keys.map((key) => ({ key, cmd }))
}
