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
  setSession: (sessionId: string | null) => void;
  setRoomId: (roomId: string | null) => void;
  setTransportMode: (transportMode: string) => void;
  setHasLocationPermission: (value: boolean | null) => void;
  setLocalStream: (stream: LocalMediaStream | null) => void;
  setRoutePoints: (points: RoutePoint[]) => void;
  clear: () => void;
};

export const useLiveBroadcastStore = create<LiveBroadcastState>((set) => ({
  sessionId: null,
  roomId: null,
  transportMode: "walking",
  hasLocationPermission: null,
  localStream: null,
  routePoints: [],
  setSession: (sessionId) => set({ sessionId }),
  setRoomId: (roomId) => set({ roomId }),
  setTransportMode: (transportMode) => set({ transportMode }),
  setHasLocationPermission: (hasLocationPermission) => set({ hasLocationPermission }),
  setLocalStream: (localStream) => set({ localStream }),
  setRoutePoints: (routePoints) => set({ routePoints }),
  clear: () =>
    set({
      sessionId: null,
      roomId: null,
      localStream: null,
      routePoints: [],
      hasLocationPermission: null,
    }),
}));

