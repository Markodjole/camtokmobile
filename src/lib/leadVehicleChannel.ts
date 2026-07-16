/**
 * Realtime lead-vehicle box channel (broadcaster side).
 *
 * The box used to travel phone → HTTP POST → Postgres → viewer HTTP poll,
 * adding 0.5–1.5s of overlay lag. Boxes now also go straight over a WebRTC
 * data channel on the existing P2P connection (~50ms). The HTTP path stays as
 * the fallback and for markets/history.
 *
 * liveP2p registers one channel per viewer connection; the lead-vehicle
 * pipeline publishes every detector frame (~4-5 Hz).
 */

export type LeadVehicleWireMessage = {
  v: 1;
  /** Device timestamp ms. */
  t: number;
  lead: {
    id: string;
    /** Raw class: motorcycle / car / bus / truck / … */
    type: string;
    status: string;
    /** "evaluating" (dashed blue) or "locked" (solid green). */
    phase: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  /** Set when we just overtook the followed vehicle. */
  pass?: { id: string; t: number };
};

type ChannelLike = {
  readyState: string;
  send: (data: string) => void;
  addEventListener?: (ev: string, fn: () => void) => void;
  onclose?: (() => void) | null;
  onerror?: (() => void) | null;
};

const channels = new Set<ChannelLike>();

export function registerLeadVehicleChannel(ch: ChannelLike): () => void {
  channels.add(ch);
  const drop = () => channels.delete(ch);
  // react-native-webrtc supports both handler styles; wire whichever exists.
  if (typeof ch.addEventListener === "function") {
    ch.addEventListener("close", drop);
    ch.addEventListener("error", drop);
  } else {
    ch.onclose = drop;
    ch.onerror = drop;
  }
  return drop;
}

export function publishLeadVehicleBox(msg: LeadVehicleWireMessage): void {
  if (channels.size === 0) return;
  let data: string;
  try {
    data = JSON.stringify(msg);
  } catch {
    return;
  }
  for (const ch of channels) {
    if (ch.readyState !== "open") continue;
    try {
      ch.send(data);
    } catch {
      channels.delete(ch);
    }
  }
}
