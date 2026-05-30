import { create } from "zustand";
import type { RoutePoint } from "@/types/live";

type LocalMediaStream = {
  toURL: () => string;
};

type LiveBroadcastState = {
  sessionId: string | null;
  roomId: string | null;
  transportMode: string;
  hasLocationPermission: boolean | null;
  localStream: LocalMediaStream | null;
  routePoints: RoutePoint[];
  /** Active WebRTC publish cleanup — survives screen navigation until session ends. */
  p2pCleanup: (() => void) | null;
  p2pSessionId: string | null;
  setSession: (sessionId: string | null) => void;
  setRoomId: (roomId: string | null) => void;
  setTransportMode: (transportMode: string) => void;
  setHasLocationPermission: (value: boolean | null) => void;
  setLocalStream: (stream: LocalMediaStream | null) => void;
  setRoutePoints: (
    points: RoutePoint[] | ((prev: RoutePoint[]) => RoutePoint[]),
  ) => void;
  setP2pCleanup: (sessionId: string | null, cleanup: (() => void) | null) => void;
  clear: () => void;
};

export const useLiveBroadcastStore = create<LiveBroadcastState>((set) => ({
  sessionId: null,
  roomId: null,
  transportMode: "bike",
  hasLocationPermission: null,
  localStream: null,
  routePoints: [],
  p2pCleanup: null,
  p2pSessionId: null,
  setSession: (sessionId) => set({ sessionId }),
  setRoomId: (roomId) => set({ roomId }),
  setTransportMode: (transportMode) => set({ transportMode }),
  setHasLocationPermission: (hasLocationPermission) => set({ hasLocationPermission }),
  setLocalStream: (localStream) => set({ localStream }),
  setRoutePoints: (routePoints) =>
    set((state) => ({
      routePoints:
        typeof routePoints === "function"
          ? routePoints(state.routePoints)
          : routePoints,
    })),
  setP2pCleanup: (p2pSessionId, p2pCleanup) => set({ p2pSessionId, p2pCleanup }),
  clear: () => {
    const { p2pCleanup } = useLiveBroadcastStore.getState();
    p2pCleanup?.();
    set({
      sessionId: null,
      roomId: null,
      localStream: null,
      routePoints: [],
      hasLocationPermission: null,
      p2pCleanup: null,
      p2pSessionId: null,
    });
  },
}));

