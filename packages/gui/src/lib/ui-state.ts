import { create } from "zustand"

export type Delivery = "steer" | "queue"

interface UiState {
  drafts: Record<string, string>
  setDraft: (key: string, value: string) => void
  delivery: Delivery
  setDelivery: (delivery: Delivery) => void
}

export const useUiStore = create<UiState>((set) => ({
  drafts: {},
  setDraft: (key, value) =>
    set((state) => (state.drafts[key] === value ? state : { drafts: { ...state.drafts, [key]: value } })),
  delivery: "steer",
  setDelivery: (delivery) => set({ delivery }),
}))

export const composerDraftKey = (sessionID: string | undefined): string => sessionID ?? "current"
