/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Native WebRTC P2P — uses `react-native-webrtc` for RTCPeerConnection,
 * and Supabase Realtime for signaling. API is identical to the web
 * implementation so callers don't need to branch.
 *
 * `registerGlobals()` is called once at module load. After that,
 * `new RTCPeerConnection()` etc. work globally, just like a browser.
 */
import {
  registerGlobals,
  RTCPeerConnection as NativeRTCPeerConnection,
  type MediaStream,
} from "react-native-webrtc";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { env } from "./env";

// Register WebRTC globals so the shared signaling logic can use the
// standard browser names (RTCPeerConnection, RTCIceCandidate …).
registerGlobals();

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

function buildIceConfig(): RTCConfiguration {
  return {
    iceServers: buildIceServers(),
    bundlePolicy: "max-bundle",
    // react-native-webrtc doesn't support rtcpMuxPolicy yet
    iceTransportPolicy: env.iceRelayOnly ? "relay" : "all",
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
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const inner = o.payload;
  if (inner && typeof inner === "object" && "type" in inner) return inner as BcPayload;
  if ("type" in o) return o as BcPayload;
  return null;
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
  return new NativeRTCPeerConnection(buildIceConfig()) as unknown as RTCPeerConnection;
}

// ─── Broadcaster ──────────────────────────────────────────────────────────────

export async function startBroadcasterP2p(
  liveSessionId: string,
  stream: MediaStream,
): Promise<() => void> {
  const supabase = getSupabase();
  const ch = supabase.channel(webrtcChannelName(liveSessionId), {
    config: { broadcast: { ack: false, self: false } },
  });

  let pc: RTCPeerConnection | null = null;
  let offerRetryTimer: ReturnType<typeof setInterval> | null = null;
  let lastOffer: string | null = null;
  let lastOfferUfrag: string | null = null;
  let isNegotiating = false;
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
    if (isNegotiating) return;
    isNegotiating = true;
    try {
      clearOfferResend();
      closePc();
      vcBuf.clear();
      lastOffer = null;
      lastOfferUfrag = null;

      const p = makePc();
      (stream as any).getTracks().forEach((t: any) => p.addTrack(t, stream as any));
      p.oniceconnectionstatechange = () => {
        if (
          p.iceConnectionState === "connected" ||
          p.iceConnectionState === "completed"
        ) clearOfferResend();
      };
      pc = p;

      const offer = await p.createOffer({} as any);
      const ug = iceUfrag((offer as any).sdp ?? "");

      p.onicecandidate = (e: any) => {
        if (!e.candidate) return;
        send({ type: "bc-candidate", candidate: e.candidate.toJSON(), forOfferUfrag: ug });
      };
      lastOfferUfrag = ug;
      await p.setLocalDescription(offer);
      const sdp = (p.localDescription as any)?.sdp ?? (offer as any).sdp ?? "";
      lastOffer = sdp;
      send({ type: "offer", sdp, offerUfrag: ug });

      let n = 0;
      offerRetryTimer = setInterval(() => {
        n++;
        if (!lastOffer || !lastOfferUfrag) { clearOfferResend(); return; }
        if (!pc || pc.signalingState !== "have-local-offer") { clearOfferResend(); return; }
        const viewerRecent = Date.now() - lastViewerReadyAt < 15000;
        if (n === 4 && viewerRecent) { clearOfferResend(); void sendOffer(); return; }
        if (n > 20) { clearOfferResend(); return; }
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
        } else if (!(alive && (iceState === "connected" || iceState === "completed"))) {
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
    if (!pc) { void sendOffer(); return; }
    const ss = pc.signalingState;
    const ice = pc.iceConnectionState;
    if (ss === "closed" || ice === "failed" || ice === "disconnected") {
      void sendOffer();
    }
  }, 10000);

  return () => {
    clearOfferResend();
    clearInterval(watchdog);
    void ch.unsubscribe();
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
  const bcBuf = new Map<string, RTCIceCandidateInit[]>();

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

  const closeViewerPc = () => {
    clearAnswerRetry();
    if (pc && pc.signalingState !== "closed") pc.close();
    pc = null;
  };

  const wire = (p: RTCPeerConnection, offerUfrag: string) => {
    (p as any).ontrack = (e: any) => {
      const s: MediaStream =
        e.streams?.[0] ??
        (() => {
          // react-native-webrtc MediaStream constructor
          const m = new (require("react-native-webrtc").MediaStream)([]);
          if (e.track) m.addTrack(e.track);
          return m;
        })();
      onRemoteStream(s);
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
    if (seenUfrags.has(ufrag) || processingUfrag === ufrag) return;
    processingUfrag = ufrag;
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
    await newPc.setLocalDescription(answer);
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
      if (n >= 6) clearReadyRetry();
    }, 1500);
  };

  await new Promise((r) => setTimeout(r, 120));
  if (!cleaned) {
    sendReady();
    startReadyRetry();
  }

  stuckTimer = setInterval(() => {
    if (cleaned) { clearStuck(); return; }
    const s = pc?.iceConnectionState;
    if (s === "connected" || s === "completed") { clearStuck(); return; }
    seenUfrags.clear();
    processingUfrag = null;
    offerEverReceived = false;
    bcBuf.clear();
    closeViewerPc();
    sendReady();
    startReadyRetry();
  }, 6000);

  return () => {
    cleaned = true;
    clearStuck();
    clearAnswerRetry();
    clearReadyRetry();
    void ch.unsubscribe();
    closeViewerPc();
    bcBuf.clear();
    seenUfrags.clear();
  };
}
