/**
 * Pure hierarchy helpers for the todo outline. The list is flat and ordered;
 * structure comes from each item's `depth` (0 = objective, 1 = stage,
 * 2 = step). Leaves — items with no deeper following siblings — are the unit
 * of completion: a parent's status is derived from its descendant leaves, so
 * a parent is complete only when all its required steps are.
 *
 * The helpers operate on the minimal `OutlineItem` shape so any consumer with
 * the same fields (core `SessionTodo.Info`, the generated SDK `Todo`, the TUI
 * sidebar item) can use them. This module has no runtime dependencies so
 * browser frontends can import it through `@prioricode/core/session/todo-tree`.
 */

export interface OutlineItem {
  readonly id?: string
  readonly content: string
  readonly status: "pending" | "in_progress" | "completed" | "cancelled"
  readonly depth?: number
}

export const depthOf = (todo: OutlineItem) => todo.depth ?? 0

export interface Node<T extends OutlineItem = OutlineItem> {
  readonly info: T
  readonly children: readonly Node<T>[]
}

/** Rebuild the outline tree from the flat ordered list. */
export const buildTree = <T extends OutlineItem>(todos: ReadonlyArray<T>): readonly Node<T>[] => {
  const roots: Node<T>[] = []
  const stack: Array<{ readonly depth: number; children: Node<T>[] }> = [{ depth: -1, children: roots }]
  for (const info of todos) {
    const children: Node<T>[] = []
    const node: Node<T> = { info, children }
    const depth = depthOf(info)
    while (stack.length > 1 && depth <= stack[stack.length - 1]!.depth) stack.pop()
    stack[stack.length - 1]!.children.push(node)
    stack.push({ depth, children })
  }
  return roots
}

/** An item is a leaf (a step) when no deeper item follows it. */
export const isLeaf = (todos: ReadonlyArray<OutlineItem>, index: number) => {
  const next = todos[index + 1]
  return next === undefined || depthOf(next) <= depthOf(todos[index]!)
}

/** The contiguous subtree rooted at `index`, including the item itself. */
export const subtree = <T extends OutlineItem>(todos: ReadonlyArray<T>, index: number): ReadonlyArray<T> => {
  if (index < 0 || index >= todos.length) return []
  const depth = depthOf(todos[index]!)
  const out: T[] = [todos[index]!]
  for (let i = index + 1; i < todos.length && depthOf(todos[i]!) > depth; i++) out.push(todos[i]!)
  return out
}

/** The step-level leaves under `index` (the item itself when it is a leaf). */
export const subtreeLeaves = <T extends OutlineItem>(todos: ReadonlyArray<T>, index: number): ReadonlyArray<T> =>
  subtree(todos, index).filter((todo, i, all) => i === all.length - 1 || depthOf(all[i + 1]!) <= depthOf(todo))

/**
 * Derived status of any item. A leaf keeps its stored status; a parent is
 * cancelled when every step was dropped, completed when every required step
 * is completed, in_progress when any step is, else pending.
 */
export const deriveStatus = (todos: ReadonlyArray<OutlineItem>, index: number): OutlineItem["status"] => {
  const leaves = subtreeLeaves(todos, index)
  if (leaves.length === 1 && leaves[0]!.id === todos[index]!.id) return todos[index]!.status
  const required = leaves.filter((leaf) => leaf.status !== "cancelled")
  if (required.length === 0) return "cancelled"
  if (required.every((leaf) => leaf.status === "completed")) return "completed"
  if (leaves.some((leaf) => leaf.status === "in_progress")) return "in_progress"
  return "pending"
}

/** Re-derive every parent's status from its steps; leaves are untouched. */
export const normalize = <T extends OutlineItem>(todos: ReadonlyArray<T>): T[] =>
  todos.map((todo, index) =>
    // status is replaced by a value of the item's own status union; the cast
    // is sound for every concrete item type in use (all carry the full union).
    isLeaf(todos, index) ? todo : ({ ...todo, status: deriveStatus(todos, index) } as T),
  )

/** Progress over the required (non-cancelled) steps under `index`. */
export const progress = (todos: ReadonlyArray<OutlineItem>, index: number) => {
  const leaves = subtreeLeaves(todos, index).filter((leaf) => leaf.status !== "cancelled")
  return { done: leaves.filter((leaf) => leaf.status === "completed").length, total: leaves.length }
}

/** Advisory: a depth jumping more than one level leaves items without an enclosing parent. */
export const outlineWarning = (todos: ReadonlyArray<OutlineItem>): string[] => {
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
