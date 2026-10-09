import { jsx as _jsx, jsxDEV as _jsxDEV, Fragment as _Fragment } from "./jsx-runtime"

export function jsxDEV(type: unknown, props?: Record<string, unknown> | null, key?: unknown): unknown {
  void key
  return _jsxDEV(type as never, props)
}

export function jsx(type: unknown, props?: Record<string, unknown> | null): unknown {
  return _jsx(type as never, props)
}

export const jsxs = jsx
export const Fragment = _Fragment
