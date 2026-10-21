import type { Info } from "@prioricode/schema/session-todo"

/**
 * Pure hierarchy helpers for the todo outline. The list is flat and ordered;
 * structure comes from each item's `depth` (0 = objective, 1 = stage,
 * 2 = step). Leaves — items with no deeper following siblings — are the unit
 * of completion: a parent's status is derived from its descendant leaves, so
 * a parent is complete only when all its required steps are.
 *
 * This module has no runtime dependencies (type-only imports) so browser
 * frontends can import it through `@prioricode/core/session/todo-tree`.
 */

export const depthOf = (todo: Info) => todo.depth ?? 0

export interface Node {
  readonly info: Info
  readonly children: readonly Node[]
}

/** Rebuild the outline tree from the flat ordered list. */
export const buildTree = (todos: ReadonlyArray<Info>): readonly Node[] => {
  const roots: Node[] = []
  const stack: Array<{ readonly depth: number; children: Node[] }> = [{ depth: -1, children: roots }]
  for (const info of todos) {
    const children: Node[] = []
    const node: Node = { info, children }
    const depth = depthOf(info)
    while (stack.length > 1 && depth <= stack[stack.length - 1]!.depth) stack.pop()
    stack[stack.length - 1]!.children.push(node)
    stack.push({ depth, children })
  }
  return roots
}

/** An item is a leaf (a step) when no deeper item follows it. */
export const isLeaf = (todos: ReadonlyArray<Info>, index: number) => {
  const next = todos[index + 1]
  return next === undefined || depthOf(next) <= depthOf(todos[index]!)
}

/** The contiguous subtree rooted at `index`, including the item itself. */
export const subtree = (todos: ReadonlyArray<Info>, index: number): ReadonlyArray<Info> => {
  if (index < 0 || index >= todos.length) return []
  const depth = depthOf(todos[index]!)
  const out: Info[] = [todos[index]!]
  for (let i = index + 1; i < todos.length && depthOf(todos[i]!) > depth; i++) out.push(todos[i]!)
  return out
}

/** The step-level leaves under `index` (the item itself when it is a leaf). */
export const subtreeLeaves = (todos: ReadonlyArray<Info>, index: number): ReadonlyArray<Info> =>
  subtree(todos, index).filter((todo, i, all) => i === all.length - 1 || depthOf(all[i + 1]!) <= depthOf(todo))

/**
 * Derived status of any item. A leaf keeps its stored status; a parent is
 * cancelled when every step was dropped, completed when every required step
 * is completed, in_progress when any step is, else pending.
 */
export const deriveStatus = (todos: ReadonlyArray<Info>, index: number): Info["status"] => {
  const leaves = subtreeLeaves(todos, index)
  if (leaves.length === 1 && leaves[0]!.id === todos[index]!.id) return todos[index]!.status
  const required = leaves.filter((leaf) => leaf.status !== "cancelled")
  if (required.length === 0) return "cancelled"
  if (required.every((leaf) => leaf.status === "completed")) return "completed"
  if (leaves.some((leaf) => leaf.status === "in_progress")) return "in_progress"
  return "pending"
}

/** Re-derive every parent's status from its steps; leaves are untouched. */
export const normalize = (todos: ReadonlyArray<Info>): Info[] =>
  todos.map((todo, index) => (isLeaf(todos, index) ? todo : { ...todo, status: deriveStatus(todos, index) }))

/** Progress over the required (non-cancelled) steps under `index`. */
export const progress = (todos: ReadonlyArray<Info>, index: number) => {
  const leaves = subtreeLeaves(todos, index).filter((leaf) => leaf.status !== "cancelled")
  return { done: leaves.filter((leaf) => leaf.status === "completed").length, total: leaves.length }
}

/** Advisory: a depth jumping more than one level leaves items without an enclosing parent. */
export const outlineWarning = (todos: ReadonlyArray<Info>): string[] => {
  const warnings: string[] = []
  let previous = -1
  for (const todo of todos) {
    const depth = depthOf(todo)
    if (depth > previous + 1)
      warnings.push(
        `Warning: "${todo.content}" jumps to depth ${depth} with no enclosing level ${depth - 1} — give it a parent (or a shallower depth) so the outline stays nested.`,
      )
    previous = depth
  }
  return warnings
}
