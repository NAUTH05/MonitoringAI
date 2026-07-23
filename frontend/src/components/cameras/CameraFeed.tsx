"use client";

import { Camera, Event } from "@/types";
import { Volume2, VolumeX, ShieldAlert, Cpu, Repeat, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Go2RtcPlayer, PlayerState } from "./Go2RtcPlayer";

interface CameraFeedProps {
  camera: Camera;
  activeEvent?: Event | null;
  onClearEvent?: () => void;
  // Expose the underlying <video> so the parent can snapshot/record it.
  onVideoRef?: (id: string, el: HTMLVideoElement | null) => void;
}

// Pull the go2rtc stream name out of a URL like
// http://host:1984/api/stream.m3u8?src=nvr_ch1  ->  nvr_ch1
// Returns null for raw rtsp:// URLs (browsers cannot play those directly).
function deriveStreamName(url: string): string | null {
  if (!url) return null;
  const u = url.trim();
  const m = u.match(/[?&]src=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (u.startsWith("rtsp://")) return null;
  // Bare stream name given directly.
  if (/^[\w.-]+$/.test(u)) return u;
  return null;
}

export function CameraFeed({
  camera,
  activeEvent,
  onClearEvent,
  onVideoRef,
}: CameraFeedProps) {
  const { t } = useTranslation();
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [useSub, setUseSub] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const activeUrl = useSub && camera.subRtspUrl ? camera.subRtspUrl : camera.rtspUrl;
  const streamName = deriveStreamName(activeUrl);
  const isOnline = camera.status === "ONLINE";

  // Register/unregister the video element with the parent for capture/record.
  useEffect(() => {
    onVideoRef?.(camera.id, videoRef.current);
    return () => onVideoRef?.(camera.id, null);
  }, [camera.id, onVideoRef, streamName]);

  // Sync mute state.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !audioEnabled;
  }, [audioEnabled]);

  // Alarm buzzer on active alert.
  useEffect(() => {
    if (!activeEvent || !activeEvent.isAlert || !audioEnabled) return;
    const playBuzzer = () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        }
        const ctx = audioContextRef.current;
        if (ctx.state === "suspended") ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } catch {
        /* ignore */
      }
    };
    playBuzzer();
    const id = setInterval(playBuzzer, 1200);
    return () => clearInterval(id);
  }, [activeEvent, audioEnabled]);

  // Auto-clear alert highlight after 6s.
  useEffect(() => {
    if (!activeEvent) return;
    const timer = setTimeout(() => onClearEvent?.(), 6000);
    return () => clearTimeout(timer);
  }, [activeEvent, onClearEvent]);

  return (
    <div
      ref={containerRef}
      className={`relative rounded-b-lg overflow-hidden border h-full transition-colors bg-black flex flex-col group ${
        activeEvent
          ? activeEvent.isAlert
            ? "border-red-700"
            : "border-orange-600"
          : "border-neutral-800"
      }`}
    >
      {/* Video area */}
      <div className="relative flex-1 min-h-0 w-full bg-black">
        {!isOnline ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 gap-2">
            <WifiOff className="w-6 h-6" />
            <span className="text-xs font-mono">{camera.status}</span>
          </div>
        ) : streamName ? (
          <>
            <Go2RtcPlayer
              streamName={streamName}
              active
              muted={!audioEnabled}
              videoRef={videoRef}
              onState={setPlayerState}
              className="w-full h-full object-cover"
            />
            {playerState !== "playing" && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[11px] font-mono text-neutral-400">
                  {playerState === "error" ? t("cameraFeed.reconnecting") : t("cameraFeed.connecting")}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 gap-1">
            <span className="text-xs text-neutral-400">
              {t("cameraFeed.noStream")}
            </span>
            <span className="text-[10px] text-neutral-600">
              {t("cameraFeed.noStreamHint")}
            </span>
          </div>
        )}

        {/* Live badge */}
        {isOnline && streamName && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 rounded bg-black/50 px-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-mono text-neutral-200">LIVE</span>
          </div>
        )}

        {/* Controls (hover) */}
        {isOnline && (
          <div className="absolute left-2 bottom-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setAudioEnabled((v) => !v)}
              title={audioEnabled ? t("cameraFeed.muteAudio") : t("cameraFeed.unmuteAudio")}
              className="p-1.5 rounded-lg bg-gray-900/80 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
            >
              {audioEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
            </button>
            {camera.subRtspUrl && (
              <button
                onClick={() => setUseSub((v) => !v)}
                title={useSub ? t("cameraFeed.switchToMain") : t("cameraFeed.switchToSub")}
                className="p-1.5 rounded-lg bg-gray-900/80 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800 flex items-center gap-1"
              >
                <Repeat className="w-3.5 h-3.5" />
                <span className="text-[9px] font-mono">{useSub ? "SUB" : "MAIN"}</span>
              </button>
            )}
          </div>
        )}

        {/* Active event overlay (thin, top strip - does not cover the center) */}
        {activeEvent && (
          <div
            className={`absolute top-2 left-2 right-16 p-2 rounded-lg border text-xs font-semibold flex items-center justify-between animate-pulse ${
              activeEvent.isAlert
                ? "bg-red-950/85 border-red-800 text-red-200"
                : "bg-orange-950/85 border-orange-800 text-orange-200"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold uppercase">{activeEvent.eventType}</span>
                <p className="text-[10px] text-gray-300 font-normal">
                  {(activeEvent.confidence * 100).toFixed(1)}%
                </p>
              </div>
            </div>
            <button
              onClick={onClearEvent}
              className="px-2 py-1 bg-red-800 hover:bg-red-700 text-white rounded text-[10px] shrink-0"
            >
              OK
            </button>
          </div>
        )}
      </div>

      {/* Info bar (below the video, never overlays it) */}
      <div className="px-3 py-2 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between text-xs shrink-0">
        <p className="text-neutral-500 truncate text-[11px]">{camera.location}</p>
        <div className="flex items-center gap-2 shrink-0">
          {isOnline ? (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-neutral-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {t("cameraFeed.online")}
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1.5 text-[10px] ${
                camera.status === "ERROR" ? "text-red-400" : "text-neutral-500"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  camera.status === "ERROR" ? "bg-red-500" : "bg-neutral-600"
                }`}
              />
              {camera.status}
            </span>
          )}

          {camera.cameraModules && camera.cameraModules.length > 0 && (
            <div
              className="flex items-center gap-0.5 text-neutral-500"
              title={t("cameraFeed.aiModulesEnabled", { count: camera.cameraModules.length })}
            >
              <Cpu className="w-3 h-3" />
              <span className="text-[10px]">{camera.cameraModules.length}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
