import { create } from "zustand";
import type { SharedDestination } from "@/lib/parseSharedDestination";

type SharedDestinationState = {
  pending: SharedDestination | null;
  lastError: string | null;
  setPending: (dest: SharedDestination | null) => void;
  setError: (message: string | null) => void;
  /** Take pending destination once (Go Live screen consumes it). */
  consume: () => SharedDestination | null;
};

export const useSharedDestinationStore = create<SharedDestinationState>(
  (set, get) => ({
    pending: null,
    lastError: null,
    setPending: (pending) => set({ pending, lastError: null }),
    setError: (lastError) => set({ lastError }),
    consume: () => {
      const pending = get().pending;
      if (pending) set({ pending: null });
      return pending;
    },
  }),
);
