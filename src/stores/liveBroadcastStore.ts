import { create } from "zustand";
import type { RoutePoint } from "@/types/live";

type LocalMediaStream = {
  toURL: () => string;
};

type LiveBroadcastState = {
  sessionId: string | null;
  localStream: LocalMediaStream | null;
  routePoints: RoutePoint[];
  setSession: (sessionId: string | null) => void;
  setLocalStream: (stream: LocalMediaStream | null) => void;
  setRoutePoints: (points: RoutePoint[]) => void;
  clear: () => void;
};

export const useLiveBroadcastStore = create<LiveBroadcastState>((set) => ({
  sessionId: null,
  localStream: null,
  routePoints: [],
  setSession: (sessionId) => set({ sessionId }),
  setLocalStream: (localStream) => set({ localStream }),
  setRoutePoints: (routePoints) => set({ routePoints }),
  clear: () => set({ sessionId: null, localStream: null, routePoints: [] }),
}));

