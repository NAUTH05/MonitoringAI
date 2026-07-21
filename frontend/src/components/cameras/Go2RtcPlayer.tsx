"use client";

import { useEffect, useRef } from "react";

// Low-latency go2rtc player: MSE (fMP4 over WebSocket) primary, WebRTC fallback.
// TCP-only MSE is enterprise-firewall friendly (reuses port 1984). Renders a
// native <video> element (no canvas loop) so RAM/CPU stay low.

export type PlayerState = "connecting" | "playing" | "error";

interface Go2RtcPlayerProps {
  streamName: string;
  className?: string;
  muted?: boolean;
  // Only hold a connection while true (viewport-gated by the parent).
  active?: boolean;
  onState?: (s: PlayerState) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

// Base URL of go2rtc. Defaults to the current host on port 1984.
function go2rtcWsUrl(streamName: string): string {
  const env = process.env.NEXT_PUBLIC_GO2RTC_URL;
  let base: string;
  if (env) {
    base = env.replace(/^http/, "ws").replace(/\/$/, "");
  } else if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    base = `${proto}://${window.location.hostname}:1984`;
  } else {
    base = "ws://localhost:1984";
  }
  return `${base}/api/ws?src=${encodeURIComponent(streamName)}`;
}

// Candidate codecs go2rtc can package into fMP4; we advertise the ones the
// browser's MediaSource can actually decode.
const MSE_CODECS = [
  "avc1.640029",
  "avc1.64002A",
  "avc1.640033",
  "hvc1.1.6.L153.B0",
  "mp4a.40.2",
  "mp4a.40.5",
  "flac",
  "opus",
];

function supportedMseCodecs(): string {
  if (typeof MediaSource === "undefined") return "";
  return MSE_CODECS.filter((c) => {
    const type = c.startsWith("mp4a") || c === "flac" || c === "opus"
      ? `audio/mp4; codecs="${c}"`
      : `video/mp4; codecs="${c}"`;
    try {
      return MediaSource.isTypeSupported(type);
    } catch {
      return false;
    }
  }).join(",");
}

export function Go2RtcPlayer({
  streamName,
  className,
  muted = true,
  active = true,
  onState,
  videoRef,
}: Go2RtcPlayerProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const video = videoRef ?? internalRef;
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const msRef = useRef<MediaSource | null>(null);
  const sbRef = useRef<SourceBuffer | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<PlayerState>("connecting");

  useEffect(() => {
    const el = video.current;
    if (!el || !streamName || !active) return;

    let stopped = false;

    const setState = (s: PlayerState) => {
      if (stateRef.current !== s) {
        stateRef.current = s;
        onState?.(s);
      }
    };

    // ---- MSE buffer plumbing ------------------------------------------------
    const flush = () => {
      const sb = sbRef.current;
      if (!sb || sb.updating || queueRef.current.length === 0) return;
      try {
        sb.appendBuffer(queueRef.current.shift() as ArrayBuffer);
      } catch {
        // Quota reached: drop everything but the tail to keep latency low.
        try {
          if (sb.buffered.length) {
            sb.remove(sb.buffered.start(0), el.currentTime - 1);
          }
        } catch {
          /* ignore */
        }
      }
    };

    const startMse = () => {
      const ms = new MediaSource();
      msRef.current = ms;
      el.src = URL.createObjectURL(ms);
      ms.addEventListener("sourceopen", () => {
        URL.revokeObjectURL(el.src);
        openWs("mse");
      });
    };

    const openWs = (mode: "mse" | "webrtc") => {
      const ws = new WebSocket(go2rtcWsUrl(streamName));
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        if (mode === "mse") {
          ws.send(JSON.stringify({ type: "mse", value: supportedMseCodecs() }));
        } else {
          startWebrtc(ws);
        }
      });

      ws.addEventListener("message", (ev) => {
        if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data);
          if (msg.type === "mse") {
            const ms = msRef.current;
            if (!ms || ms.readyState !== "open") return;
            const sb = ms.addSourceBuffer(msg.value);
            sb.mode = "segments";
            sb.addEventListener("updateend", flush);
            sbRef.current = sb;
          } else if (msg.type === "webrtc/answer" || msg.type === "webrtc") {
            pcRef.current?.setRemoteDescription({ type: "answer", sdp: msg.value });
          } else if (msg.type === "webrtc/candidate" && msg.value) {
            pcRef.current?.addIceCandidate({ candidate: msg.value, sdpMid: "0" });
          } else if (msg.type === "error") {
            fallbackOrRetry();
          }
        } else {
          queueRef.current.push(ev.data as ArrayBuffer);
          flush();
        }
      });

      ws.addEventListener("close", () => {
        if (!stopped) fallbackOrRetry();
      });
      ws.addEventListener("error", () => ws.close());
    };

    const startWebrtc = async (ws: WebSocket) => {
      const pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: "max-bundle",
      });
      pcRef.current = pc;
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addEventListener("track", (e) => {
        el.srcObject = e.streams[0];
      });
      pc.addEventListener("icecandidate", (e) => {
        if (e.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "webrtc/candidate", value: e.candidate.candidate }));
        }
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "webrtc/offer", value: offer.sdp }));
    };

    let usedFallback = false;
    const fallbackOrRetry = () => {
      if (stopped) return;
      cleanupConnections();
      if (!usedFallback) {
        // MSE failed once → try WebRTC before backing off.
        usedFallback = true;
        setState("connecting");
        startWebrtcFresh();
        return;
      }
      setState("error");
      reconnectRef.current = setTimeout(() => {
        if (!stopped) {
          usedFallback = false;
          setState("connecting");
          startMse();
        }
      }, 3000);
    };

    const startWebrtcFresh = () => {
      el.removeAttribute("src");
      el.load();
      openWs("webrtc");
    };

    const onPlaying = () => setState("playing");
    el.addEventListener("playing", onPlaying);

    const tryPlay = () => el.play().catch(() => undefined);
    el.addEventListener("loadeddata", tryPlay);
    el.addEventListener("canplay", tryPlay);

    // Kick off with MSE.
    setState("connecting");
    if (typeof MediaSource !== "undefined") {
      startMse();
    } else {
      startWebrtcFresh();
    }

    function cleanupConnections() {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
      try {
        pcRef.current?.close();
      } catch {
        /* ignore */
      }
      pcRef.current = null;
      sbRef.current = null;
      msRef.current = null;
      queueRef.current = [];
    }

    return () => {
      stopped = true;
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("loadeddata", tryPlay);
      el.removeEventListener("canplay", tryPlay);
      cleanupConnections();
      try {
        el.srcObject = null;
        el.removeAttribute("src");
        el.load();
      } catch {
        /* ignore */
      }
    };
  }, [streamName, active, onState, video]);

  return (
    <video
      ref={video}
      className={className}
      autoPlay
      playsInline
      muted={muted}
    />
  );
}
