/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Native WebRTC P2P — uses `react-native-webrtc` for RTCPeerConnection,
 * and Supabase Realtime for signaling. API is identical to the web
 * implementation so callers don't need to branch.
 *
 * `registerGlobals()` is called once at module load. After that,
 * `new RTCPeerConnection()` etc. work globally, just like a browser.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { env } from "./env";
import { registerLeadVehicleChannel } from "./leadVehicleChannel";

type MediaStream = {
  getTracks: () => Array<{ stop?: () => void }>;
  addTrack?: (track: unknown) => void;
};

type RtcRuntime = {
  RTCPeerConnection: new (cfg: RTCConfiguration) => RTCPeerConnection;
  registerGlobals?: () => void;
  MediaStream?: new (...args: unknown[]) => MediaStream;
};

let rtcRuntime: RtcRuntime | null = null;
try {
  // Expo Go doesn't include this native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  rtcRuntime = require("react-native-webrtc") as RtcRuntime;
  rtcRuntime.registerGlobals?.();
} catch {
  rtcRuntime = null;
}

// ─── Outbound stats logging ──────────────────────────────────────────────────
// Answers "what are we ACTUALLY sending" (resolution / fps / bitrate / codec)
// in logcat — enable with EXPO_PUBLIC_P2P_STATS=1. Logs via console.warn so it
// shows in release builds too.

let statsTimer: ReturnType<typeof setInterval> | null = null;

function startP2pStatsLogging(pc: RTCPeerConnection): void {
  const raw = process.env.EXPO_PUBLIC_P2P_STATS;
  if (raw !== "1" && raw !== "true") return;
  if (statsTimer) clearInterval(statsTimer);
  let lastBytes = 0;
  let lastAt = Date.now();
  statsTimer = setInterval(async () => {
    if (!pc || (pc as any).signalingState === "closed") {
      if (statsTimer) clearInterval(statsTimer);
      statsTimer = null;
      return;
    }
    try {
      const stats: Map<string, any> = await (pc as any).getStats();
      let out: any = null;
      const byId: Record<string, any> = {};
      stats.forEach((v: any, k: string) => {
        byId[k] = v;
        if (v.type === "outbound-rtp" && (v.kind ?? v.mediaType) === "video") {
          out = v;
        }
      });
      if (!out) return;
      const now = Date.now();
      const bytes = out.bytesSent ?? 0;
      const kbps =
        lastBytes > 0
          ? Math.round(((bytes - lastBytes) * 8) / Math.max(1, now - lastAt))
          : 0;
      lastBytes = bytes;
      lastAt = now;
      const codec = byId[out.codecId]?.mimeType ?? "?";
      // Connection path + bandwidth estimate: distinguishes "direct P2P but
      // weak network" from "everything is squeezing through the TURN relay".
      let path = "?";
      let bwe = "?";
      let rtt = "?";
      try {
        let pair: any = null;
        stats.forEach((v: any) => {
          if (v.type === "transport" && v.selectedCandidatePairId) {
            pair = byId[v.selectedCandidatePairId] ?? pair;
          }
        });
        if (!pair) {
          stats.forEach((v: any) => {
            if (v.type === "candidate-pair" && v.nominated && v.state === "succeeded") {
              pair = v;
            }
          });
        }
        if (pair) {
          const local = byId[pair.localCandidateId];
          const remote = byId[pair.remoteCandidateId];
          path = `${local?.candidateType ?? "?"}->${remote?.candidateType ?? "?"}`;
          if (typeof pair.availableOutgoingBitrate === "number") {
            bwe = `${Math.round(pair.availableOutgoingBitrate / 1000)}kbps`;
          }
          if (typeof pair.currentRoundTripTime === "number") {
            rtt = `${Math.round(pair.currentRoundTripTime * 1000)}ms`;
          }
        }
      } catch {
        // best-effort
      }
      console.warn(
        `[p2p-stats] ${out.frameWidth ?? "?"}x${out.frameHeight ?? "?"}` +
          ` fps=${out.framesPerSecond ?? "?"} ${kbps}kbps codec=${codec}` +
          ` limited=${out.qualityLimitationReason ?? "?"}` +
          ` path=${path} bwe=${bwe} rtt=${rtt}`,
      );
    } catch {
      // stats are best-effort
    }
  }, 10_000);
}

// ─── SDP bitrate floor ───────────────────────────────────────────────────────
// x-google-{min,start}-bitrate on the video codec fmtp lines: keeps libwebrtc's
// delay-based estimator from slashing a clean path to sub-500kbps when the hot
// phone's own pacing jitter looks like congestion. Works alongside (and even
// when the build ignores) RTCRtpEncodingParameters.minBitrate.

function mungeVideoBitrates(sdp: string): string {
  if (!sdp) return sdp;
  try {
    const lines = sdp.split("\r\n");
    let inVideo = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.startsWith("m=")) inVideo = l.startsWith("m=video");
      if (!inVideo) continue;
      // Only real encoder codecs: rtx (apt=...), red and ulpfec fmtp lines
      // must stay untouched — appending there makes Chrome reject the offer
      // and the viewer never answers (no video at all).
      if (
        l.startsWith("a=fmtp:") &&
        !l.includes("x-google-min-bitrate") &&
        !l.includes("apt=") &&
        l.includes("profile-level-id")
      ) {
        lines[i] = `${l};x-google-min-bitrate=1200;x-google-start-bitrate=2500;x-google-max-bitrate=6000`;
      }
    }
    return lines.join("\r\n");
  } catch {
    return sdp;
  }
}

// ─── ICE config ───────────────────────────────────────────────────────────────

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  if (env.turnUrl && env.turnUsername && env.turnCredential) {
    servers.push({
      urls: [env.turnUrl],
      username: env.turnUsername,
      credential: env.turnCredential,
    });
  }
  return servers;
}

function hasTurnCredentials(): boolean {
  return !!(env.turnUrl && env.turnUsername && env.turnCredential);
}

function buildIceConfig(): RTCConfiguration {
  const relay = env.iceRelayOnly && hasTurnCredentials();
  return {
    iceServers: buildIceServers(),
    bundlePolicy: "max-bundle",
    // react-native-webrtc doesn't support rtcpMuxPolicy yet
    iceTransportPolicy: relay ? "relay" : "all",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function webrtcChannelName(liveSessionId: string) {
  return `live-webrtc:${liveSessionId}`;
}

type BcPayload = Record<string, unknown> & {
  type: string;
  sdp?: string;
  offerUfrag?: string;
  forOfferUfrag?: string;
  candidate?: RTCIceCandidateInit;
};

function parseRawPayload(raw: unknown): BcPayload | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      return parseRawPayload(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const candidates: unknown[] = [o.payload, o];
  const nested = o.payload;
  if (nested && typeof nested === "object") {
    const p = nested as Record<string, unknown>;
    candidates.push(p.payload);
  }
  for (const c of candidates) {
    if (c && typeof c === "object" && "type" in c) {
      return c as BcPayload;
    }
  }
  return null;
}

function teardownChannel(
  supabase: ReturnType<typeof getSupabase>,
  ch: RealtimeChannel,
) {
  void ch.unsubscribe();
  supabase.removeChannel(ch);
}

function waitSubscribed(ch: RealtimeChannel) {
  return new Promise<void>((resolve, reject) => {
    ch.subscribe((status, err) => {
      if (status === "SUBSCRIBED") resolve();
      else if (status === "CHANNEL_ERROR") reject(err ?? new Error("Realtime channel error"));
      else if (status === "TIMED_OUT") reject(new Error("Realtime subscribe timed out"));
    });
  });
}

function iceUfrag(sdp: string): string {
  const m = /a=ice-ufrag:([^\s\r\n]+)/.exec(sdp);
  if (m) return m[1] as string;
  let h = 0;
  for (let i = 0; i < Math.min(sdp.length, 500); i++) h = (h * 33 + sdp.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}`;
}

// react-native-webrtc wraps RTCPeerConnection — cast to any for methods
// not yet in the community type definitions.
function makePc(): RTCPeerConnection {
  if (!rtcRuntime) {
    throw new Error("WebRTC native module unavailable (Expo Go).");
  }
  return new rtcRuntime.RTCPeerConnection(buildIceConfig()) as unknown as RTCPeerConnection;
}

// ─── Broadcaster ──────────────────────────────────────────────────────────────

export async function startBroadcasterP2p(
  liveSessionId: string,
  stream: MediaStream,
): Promise<() => void> {
  if (!rtcRuntime) {
    console.warn("WebRTC unavailable in Expo Go; use custom dev client for live video.");
    return () => undefined;
  }
  const supabase = getSupabase();
  const ch = supabase.channel(webrtcChannelName(liveSessionId), {
    config: { broadcast: { ack: false, self: false } },
  });

  let pc: RTCPeerConnection | null = null;
  let offerRetryTimer: ReturnType<typeof setInterval> | null = null;
  let lastOffer: string | null = null;
  let lastOfferUfrag: string | null = null;
  let isNegotiating = false;
  let negotiateGen = 0;
  let cleaned = false;
  let lastViewerReadyAt = 0;
  const vcBuf = new Map<string, RTCIceCandidateInit[]>();

  const send = (payload: BcPayload) =>
    void ch.send({ type: "broadcast", event: "webrtc", payload });

  const clearOfferResend = () => {
    if (offerRetryTimer) { clearInterval(offerRetryTimer); offerRetryTimer = null; }
  };
  const closePc = () => {
    if (pc && pc.signalingState !== "closed") pc.close();
    pc = null;
  };

  const sendOffer = async () => {
    if (isNegotiating || cleaned) return;
    isNegotiating = true;
    const gen = ++negotiateGen;
    let localPc: RTCPeerConnection | null = null;
    try {
      clearOfferResend();
      closePc();
      vcBuf.clear();
      lastOffer = null;
      lastOfferUfrag = null;

      localPc = makePc();
      (stream as any)
        .getTracks()
        .forEach((t: any) => localPc!.addTrack(t, stream as any));
      // Realtime lead-vehicle boxes straight to the viewer (skip the server
      // round-trip). Unordered + no retransmits: stale boxes are useless.
      try {
        const dc = (localPc as any).createDataChannel?.("camtok-lead", {
          ordered: false,
          maxRetransmits: 0,
        });
        if (dc) registerLeadVehicleChannel(dc);
      } catch {
        // Data channel is an enhancement; video must not depend on it.
      }
      // "balanced": on sustained thermal throttling (43°C+ measured on the
      // budget test device) the encoder must be allowed to trade some
      // resolution for framerate — pinning 1080p ("maintain-resolution") made
      // fps decay 15→2 while the picture stayed sharp-but-frozen. A smooth
      // 720p is far better viewing than a 1080p slideshow.
      try {
        const sender = (localPc as any)
          .getSenders?.()
          .find((s: any) => s?.track?.kind === "video");
        if (sender?.setParameters) {
          const params = sender.getParameters() ?? {};
          params.degradationPreference = "balanced";
          // libwebrtc's default bitrate cap (~2 Mbps) makes 1080p traffic
          // video mush — every frame is full of new detail. The web
          // broadcaster already sets 6 Mbps; match it here (mobile uplink
          // allowing — WebRTC still adapts downward when the network can't).
          // Floor + ceiling. The floor matters as much as the ceiling: the
          // delay-based estimator panics on sender-side pacing jitter (hot
          // phone) and slashed a CLEAN path (viewer measured lost=0 drop=0)
          // down to ~300 kbps / 480x256. Don't let it dive below watchable.
          if (Array.isArray(params.encodings) && params.encodings[0]) {
            params.encodings[0].maxBitrate = 6_000_000;
            params.encodings[0].minBitrate = 1_200_000;
          } else {
            params.encodings = [{ maxBitrate: 6_000_000, minBitrate: 1_200_000 }];
          }
          await sender.setParameters(params);
        }
        // Traffic scenes are motion-dominated; hint the encoder accordingly.
        try {
          const track = sender?.track as { contentHint?: string } | undefined;
          if (track && "contentHint" in track) track.contentHint = "motion";
        } catch {
          // optional
        }
        startP2pStatsLogging(localPc);
      } catch {
        // Older webrtc builds without degradationPreference — non-fatal.
      }
      localPc.oniceconnectionstatechange = () => {
        if (
          localPc &&
          (localPc.iceConnectionState === "connected" ||
            localPc.iceConnectionState === "completed")
        ) {
          clearOfferResend();
        }
      };
      if (cleaned || gen !== negotiateGen) return;
      pc = localPc;

      const offer = await localPc.createOffer({} as any);
      if (
        cleaned ||
        gen !== negotiateGen ||
        localPc.signalingState === "closed"
      ) {
        return;
      }

      const ug = iceUfrag((offer as any).sdp ?? "");
      localPc.onicecandidate = (e: any) => {
        if (!e.candidate || cleaned || gen !== negotiateGen) return;
        send({
          type: "bc-candidate",
          candidate: e.candidate.toJSON(),
          forOfferUfrag: ug,
        });
      };
      lastOfferUfrag = ug;
      try {
        (offer as any).sdp = mungeVideoBitrates((offer as any).sdp ?? "");
        await localPc.setLocalDescription(offer);
      } catch (e) {
        if ((localPc.signalingState as string) !== "closed") {
          console.warn("[p2p] setLocalDescription(offer) failed:", e);
        }
        if (pc === localPc) closePc();
        return;
      }
      if (cleaned || gen !== negotiateGen || pc !== localPc) return;

      const sdp =
        (localPc.localDescription as any)?.sdp ?? (offer as any).sdp ?? "";
      lastOffer = sdp;
      send({ type: "offer", sdp, offerUfrag: ug });

      let n = 0;
      offerRetryTimer = setInterval(() => {
        n++;
        if (cleaned || gen !== negotiateGen) {
          clearOfferResend();
          return;
        }
        if (!lastOffer || !lastOfferUfrag) {
          clearOfferResend();
          return;
        }
        if (!pc || pc.signalingState !== "have-local-offer") {
          clearOfferResend();
          return;
        }
        const viewerRecent = Date.now() - lastViewerReadyAt < 15000;
        if (n === 4 && viewerRecent && !isNegotiating) {
          clearOfferResend();
          void sendOffer();
          return;
        }
        if (n > 20) {
          clearOfferResend();
          return;
        }
        send({ type: "offer", sdp: lastOffer, offerUfrag: lastOfferUfrag });
      }, 2000);
    } finally {
      isNegotiating = false;
    }
  };

  ch.on("broadcast", { event: "webrtc" }, async (raw: unknown) => {
    const msg = parseRawPayload(raw);
    if (!msg) return;
    if (msg.type === "offer" || msg.type === "bc-candidate") return;
    try {
      if (msg.type === "viewer-ready") {
        lastViewerReadyAt = Date.now();
        const iceState = pc?.iceConnectionState;
        const pcState = pc?.connectionState;
        const alive =
          !!pc &&
          pc.signalingState !== "closed" &&
          iceState !== "failed" &&
          iceState !== "disconnected" &&
          pcState !== "failed" &&
          pcState !== "closed";
        if (alive && lastOffer && lastOfferUfrag && pc!.signalingState === "have-local-offer") {
          send({ type: "offer", sdp: lastOffer, offerUfrag: lastOfferUfrag });
        } else if (alive && (iceState === "connected" || iceState === "completed")) {
          await sendOffer();
        } else {
          await sendOffer();
        }
      } else if (msg.type === "answer" && typeof msg.sdp === "string") {
        if (!pc || pc.signalingState === "closed") return;
        const ansUfrag = typeof msg.forOfferUfrag === "string" ? msg.forOfferUfrag : null;
        if (ansUfrag && lastOfferUfrag && ansUfrag !== lastOfferUfrag) return;
        if (pc.signalingState !== "have-local-offer") return;
        try { await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp } as any); }
        catch { return; }
        clearOfferResend();
        const key = ansUfrag ?? lastOfferUfrag ?? "";
        const buffered = vcBuf.get(key) ?? [];
        vcBuf.clear();
        for (const cand of buffered) {
          try { await (pc as any).addIceCandidate(cand); } catch { /* ignore */ }
        }
      } else if (
        msg.type === "vc-candidate" &&
        msg.candidate &&
        typeof msg.forOfferUfrag === "string"
      ) {
        const forU = msg.forOfferUfrag;
        if (lastOfferUfrag && forU !== lastOfferUfrag) return;
        const cand = msg.candidate;
        if (pc && pc.signalingState !== "closed" && pc.remoteDescription) {
          try { await (pc as any).addIceCandidate(cand); } catch { /* ignore */ }
        } else {
          const buf = vcBuf.get(forU) ?? [];
          buf.push(cand);
          vcBuf.set(forU, buf);
        }
      }
    } catch { /* ignore */ }
  });

  await waitSubscribed(ch);
  void sendOffer();

  const watchdog = setInterval(() => {
    if (cleaned || isNegotiating) return;
    if (!pc) {
      void sendOffer();
      return;
    }
    const ss = pc.signalingState;
    const ice = pc.iceConnectionState;
    if (ss === "closed" || ice === "failed" || ice === "disconnected") {
      void sendOffer();
    }
  }, 10000);

  return () => {
    cleaned = true;
    negotiateGen++;
    clearOfferResend();
    clearInterval(watchdog);
    teardownChannel(supabase, ch);
    closePc();
    vcBuf.clear();
    lastOfferUfrag = null;
  };
}

// ─── Viewer ───────────────────────────────────────────────────────────────────

export async function startViewerP2p(
  liveSessionId: string,
  onRemoteStream: (stream: MediaStream) => void,
  onFailure?: (message: string) => void,
): Promise<() => void> {
  if (!rtcRuntime) {
    onFailure?.("WebRTC unavailable in Expo Go. Install the dev client build.");
    return () => undefined;
  }
  const supabase = getSupabase();
  const ch = supabase.channel(webrtcChannelName(liveSessionId), {
    config: { broadcast: { ack: false, self: false } },
  });

  let pc: RTCPeerConnection | null = null;
  let cleaned = false;
  let negotiateId = 0;
  const seenUfrags = new Set<string>();
  let processingUfrag: string | null = null;
  let stuckTimer: ReturnType<typeof setInterval> | null = null;
  let answerRetryTimer: ReturnType<typeof setInterval> | null = null;
  let readyRetryTimer: ReturnType<typeof setInterval> | null = null;
  let offerEverReceived = false;
  let negotiationStartedAt = 0;
  let gotRemoteTrack = false;
  const bcBuf = new Map<string, RTCIceCandidateInit[]>();
  const remoteMedia =
    rtcRuntime?.MediaStream != null
      ? new rtcRuntime.MediaStream([])
      : null;

  const send = (payload: BcPayload) =>
    void ch.send({ type: "broadcast", event: "webrtc", payload });

  const clearStuck = () => { if (stuckTimer) { clearInterval(stuckTimer); stuckTimer = null; } };
  const clearAnswerRetry = () => {
    if (answerRetryTimer) { clearInterval(answerRetryTimer); answerRetryTimer = null; }
  };
  const clearReadyRetry = () => {
    if (readyRetryTimer) { clearInterval(readyRetryTimer); readyRetryTimer = null; }
  };
  const fail = (m: string) => { if (!cleaned) onFailure?.(m); };

  const clearRemoteMedia = () => {
    if (!remoteMedia) return;
    const rm = remoteMedia as MediaStream & { removeTrack?: (t: unknown) => void };
    for (const t of [...remoteMedia.getTracks()]) {
      rm.removeTrack?.(t);
    }
  };

  const closeViewerPc = () => {
    clearAnswerRetry();
    if (pc && pc.signalingState !== "closed") pc.close();
    pc = null;
    clearRemoteMedia();
    gotRemoteTrack = false;
  };

  const emitRemoteStream = () => {
    if (!remoteMedia || remoteMedia.getTracks().length === 0) return;
    gotRemoteTrack = true;
    const MediaStreamCtor = rtcRuntime?.MediaStream;
    if (!MediaStreamCtor) return;
    const out = new MediaStreamCtor([]);
    for (const track of remoteMedia.getTracks()) {
      out.addTrack?.(track);
    }
    onRemoteStream(out);
  };

  const wire = (p: RTCPeerConnection, offerUfrag: string) => {
    (p as any).ontrack = (e: any) => {
      const stream = e.streams?.[0];
      if (stream && remoteMedia) {
        for (const track of stream.getTracks()) {
          if (!remoteMedia.getTracks().some((t) => t === track)) {
            remoteMedia.addTrack?.(track);
          }
        }
      } else if (e.track && remoteMedia) {
        if (!remoteMedia.getTracks().some((t) => t === e.track)) {
          remoteMedia.addTrack?.(e.track);
        }
      } else {
        const MediaStreamCtor = rtcRuntime?.MediaStream;
        if (!MediaStreamCtor) return;
        const m = new MediaStreamCtor([]);
        if (e.track) m.addTrack?.(e.track);
        onRemoteStream(m);
        return;
      }
      emitRemoteStream();
    };
    p.oniceconnectionstatechange = () => {
      if (cleaned) return;
      const s = p.iceConnectionState;
      if (s === "connected" || s === "completed") {
        clearStuck();
        clearAnswerRetry();
      }
      if (s === "failed" && p === pc) fail("ICE failed.");
    };
    p.onconnectionstatechange = () => {
      if (cleaned) return;
      if (p.connectionState === "connected" || p.connectionState === "connecting") {
        clearStuck();
      }
      if (p.connectionState === "failed" && p === pc) fail("Connection failed.");
    };
    p.onicecandidate = (e: any) => {
      if (cleaned || p !== pc) return;
      if (!e.candidate) return;
      send({
        type: "vc-candidate",
        candidate: e.candidate.toJSON(),
        forOfferUfrag: offerUfrag,
      });
    };
  };

  const applyOffer = async (om: { sdp: string; offerUfrag?: string }) => {
    const ufrag = om.offerUfrag || iceUfrag(om.sdp);
    if (!ufrag) return;
    offerEverReceived = true;
    clearReadyRetry();
    if (processingUfrag === ufrag) return;
    if (seenUfrags.has(ufrag)) {
      const cur = pc;
      const ice = cur?.iceConnectionState;
      const stalled =
        !gotRemoteTrack &&
        negotiationStartedAt > 0 &&
        Date.now() - negotiationStartedAt > 18_000;
      const canRetry =
        !cur ||
        cur.signalingState === "closed" ||
        ice === "failed" ||
        ice === "disconnected" ||
        stalled;
      if (!canRetry) return;
      seenUfrags.delete(ufrag);
    }
    processingUfrag = ufrag;
    negotiationStartedAt = Date.now();
    gotRemoteTrack = false;
    const g = ++negotiateId;
    closeViewerPc();
    if (cleaned) { processingUfrag = null; return; }
    const newPc = makePc();
    wire(newPc, ufrag);
    pc = newPc;
    try {
      await newPc.setRemoteDescription({ type: "offer", sdp: om.sdp } as any);
    } catch (e) {
      processingUfrag = null;
      if (!cleaned) fail(e instanceof Error ? e.message : "setRemote err");
      return;
    }
    if (g !== negotiateId || cleaned) return;

    const buffered = bcBuf.get(ufrag) ?? [];
    bcBuf.delete(ufrag);
    for (const cand of buffered) {
      try { await (newPc as any).addIceCandidate(cand); } catch { /* ignore */ }
    }

    let answer: any;
    try {
      answer = await newPc.createAnswer({} as any);
    } catch (e) {
      processingUfrag = null;
      if (!cleaned) fail(e instanceof Error ? e.message : "createAnswer err");
      return;
    }
    if (g !== negotiateId || cleaned) return;
    try {
      await newPc.setLocalDescription(answer);
    } catch (e) {
      processingUfrag = null;
      if (newPc.signalingState !== "closed" && !cleaned) {
        fail(e instanceof Error ? e.message : "setLocalDescription err");
      }
      return;
    }
    if (g !== negotiateId || cleaned) return;

    const answerSdp = (newPc.localDescription as any)?.sdp ?? answer.sdp ?? "";
    seenUfrags.add(ufrag);
    processingUfrag = null;

    const sendAns = () => {
      if (cleaned) return;
      send({ type: "answer", sdp: answerSdp, forOfferUfrag: ufrag });
    };
    sendAns();

    clearAnswerRetry();
    let r = 0;
    answerRetryTimer = setInterval(() => {
      if (cleaned) { clearAnswerRetry(); return; }
      if (g !== negotiateId) { clearAnswerRetry(); return; }
      const cur = pc;
      if (!cur || cur.signalingState === "closed") { clearAnswerRetry(); return; }
      if (
        cur.iceConnectionState === "connected" ||
        cur.iceConnectionState === "completed"
      ) { clearAnswerRetry(); return; }
      r++;
      if (r > 10) { clearAnswerRetry(); return; }
      sendAns();
    }, 2000);
  };

  ch.on("broadcast", { event: "webrtc" }, async (raw: unknown) => {
    const msg = parseRawPayload(raw);
    if (!msg) return;
    if (msg.type === "viewer-ready" || msg.type === "answer" || msg.type === "vc-candidate") return;
    if (msg.type === "offer" && typeof msg.sdp === "string") {
      void applyOffer({
        sdp: msg.sdp,
        offerUfrag: typeof msg.offerUfrag === "string" ? msg.offerUfrag : undefined,
      });
    } else if (
      msg.type === "bc-candidate" &&
      msg.candidate &&
      typeof msg.forOfferUfrag === "string"
    ) {
      const forU = msg.forOfferUfrag;
      const candidate = msg.candidate;
      const curPc = pc;
      if (curPc && curPc.signalingState !== "closed" && curPc.remoteDescription) {
        try { await (curPc as any).addIceCandidate(candidate); } catch { /* ignore */ }
      } else {
        const buf = bcBuf.get(forU) ?? [];
        buf.push(candidate);
        bcBuf.set(forU, buf);
      }
    }
  });

  await waitSubscribed(ch);

  const sendReady = () => {
    if (cleaned) return;
    send({ type: "viewer-ready" });
  };

  const startReadyRetry = () => {
    clearReadyRetry();
    let n = 0;
    readyRetryTimer = setInterval(() => {
      if (cleaned || offerEverReceived) { clearReadyRetry(); return; }
      n++;
      sendReady();
      if (n >= 12) clearReadyRetry(); // ping up to ~24 s
    }, 2000);
  };

  await new Promise((r) => setTimeout(r, 120));
  if (!cleaned) {
    sendReady();
    startReadyRetry();
  }

  const resetNegotiation = () => {
    seenUfrags.clear();
    processingUfrag = null;
    negotiationStartedAt = 0;
    gotRemoteTrack = false;
    offerEverReceived = false;
    bcBuf.clear();
    closeViewerPc();
    sendReady();
    startReadyRetry();
  };

  stuckTimer = setInterval(() => {
    if (cleaned) { clearStuck(); return; }
    const ice = pc?.iceConnectionState;
    const conn = pc?.connectionState;
    if (ice === "connected" || ice === "completed") {
      clearStuck();
      return;
    }
    if (!offerEverReceived) {
      sendReady();
      startReadyRetry();
      return;
    }
    const checkingTooLong =
      (ice === "checking" || ice === "new" || conn === "connecting") &&
      negotiationStartedAt > 0 &&
      Date.now() - negotiationStartedAt > 20_000 &&
      !gotRemoteTrack;
    if (checkingTooLong) {
      resetNegotiation();
      return;
    }
    if (ice === "checking" || ice === "new" || conn === "connecting") {
      return;
    }
    if (ice === "failed" || ice === "disconnected" || conn === "failed") {
      resetNegotiation();
    }
  }, 8_000);

  return () => {
    cleaned = true;
    clearStuck();
    clearAnswerRetry();
    clearReadyRetry();
    teardownChannel(supabase, ch);
    closeViewerPc();
    bcBuf.clear();
    seenUfrags.clear();
  };
}
