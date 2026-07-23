"use client";

import { Camera, Event } from "@/types";
import { captureFrameLocal, startRecordLocalManual, ActiveRecorder } from "@/lib/capture";
import {
  Volume2,
  VolumeX,
  ShieldAlert,
  WifiOff,
  RotateCw,
  X,
  Shield,
  Camera as CameraIcon,
  Video as VideoIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Go2RtcPlayer, PlayerState } from "./Go2RtcPlayer";

interface CameraFeedProps {
  camera: Camera;
  activeEvent?: Event | null;
  onClearEvent?: () => void;
  // Expose the underlying <video> so the parent can snapshot/record it.
  onVideoRef?: (id: string, el: HTMLVideoElement | null) => void;
  onResolution?: (res: { width: number; height: number; aspectRatio: number }) => void;
}

function deriveStreamName(url: string): string | null {
  if (!url) return null;
  const u = url.trim();
  const m = u.match(/[?&]src=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (u.startsWith("rtsp://")) return null;
  if (/^[\w.-]+$/.test(u)) return u;
  return null;
}

export function CameraFeed({
  camera,
  activeEvent,
  onClearEvent,
  onVideoRef,
  onResolution,
}: CameraFeedProps) {
  const { t } = useTranslation();
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");
  const [reloadKey, setReloadKey] = useState(0);
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  // Unlimited manual video recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const popupVideoRef = useRef<HTMLVideoElement>(null);

  // Small grid view ALWAYS defaults to SUB stream (if present, else main)
  const gridUrl = camera.subRtspUrl ? camera.subRtspUrl : camera.rtspUrl;
  const gridStreamName = deriveStreamName(gridUrl);

  // Fullscreen Popup modal ALWAYS plays MAIN stream (HD)
  const mainUrl = camera.rtspUrl;
  const mainStreamName = deriveStreamName(mainUrl);

  const isOnline = camera.status === "ONLINE";

  useEffect(() => {
    onVideoRef?.(camera.id, videoRef.current);
    return () => onVideoRef?.(camera.id, null);
  }, [camera.id, onVideoRef, gridStreamName]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !audioEnabled;
    if (popupVideoRef.current) popupVideoRef.current.muted = !audioEnabled;
  }, [audioEnabled]);

  // Handle Escape key to close popup modal
  useEffect(() => {
    if (!isPopupOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPopupOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPopupOpen]);

  // Auto-stop recording if modal is closed
  useEffect(() => {
    if (!isPopupOpen && isRecording) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      setIsRecording(false);
      setRecordSeconds(0);
    }
  }, [isPopupOpen, isRecording]);

  const toggleRecording = () => {
    if (isRecording) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      setIsRecording(false);
      setRecordSeconds(0);
    } else if (popupVideoRef.current) {
      const rec = startRecordLocalManual(popupVideoRef.current, camera.name, () => {
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        setIsRecording(false);
        setRecordSeconds(0);
      });
      if (rec) {
        recorderRef.current = rec;
        setIsRecording(true);
        setRecordSeconds(0);
        recordTimerRef.current = setInterval(() => {
          setRecordSeconds((s) => s + 1);
        }, 1000);
      }
    }
  };

  const formatRecordTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      <div
        ref={containerRef}
        className={`relative rounded-b-lg overflow-hidden border border-t-0 h-full transition-colors bg-black flex flex-col group ${
          activeEvent
            ? activeEvent.isAlert
              ? "border-red-700"
              : "border-orange-600"
            : "border-neutral-800"
        }`}
      >
        {/* Video Area (Clicking opens Popup Modal) */}
        <div
          onClick={() => isOnline && setIsPopupOpen(true)}
          className="relative flex-1 min-h-0 w-full bg-black cursor-pointer"
          title={isOnline ? "Click vào đây để mở luồng chính HD" : undefined}
        >
          {!isOnline ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500 gap-2">
              <WifiOff className="w-6 h-6" />
              <span className="text-xs font-mono">{camera.status}</span>
            </div>
          ) : gridStreamName ? (
            <>
              {/* Forced FIT scale mode (object-contain bg-black) */}
              <Go2RtcPlayer
                key={`${gridStreamName}-${reloadKey}`}
                streamName={gridStreamName}
                active
                muted={!audioEnabled}
                videoRef={videoRef}
                onState={setPlayerState}
                onResolution={onResolution}
                className="w-full h-full object-contain bg-black"
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
            </div>
          )}

          {/* Hover controls bar */}
          {isOnline && (
            <div
              className="absolute left-2 bottom-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              onClick={(e) => e.stopPropagation()}
            >
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
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                title="Tải lại luồng camera này"
                className="p-1.5 rounded-lg bg-gray-900/80 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Active event overlay */}
          {activeEvent && (
            <div
              className={`absolute top-2 left-2 right-2 p-2 rounded-lg border text-xs font-semibold flex items-center justify-between animate-pulse z-10 ${
                activeEvent.isAlert
                  ? "bg-red-950/85 border-red-800 text-red-200"
                  : "bg-orange-950/85 border-orange-800 text-orange-200"
              }`}
              onClick={(e) => e.stopPropagation()}
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
      </div>

      {/* FULLSCREEN POPUP MODAL (Rendered via Portal to body so it floats in exact center of screen) */}
      {isPopupOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 select-none animate-in fade-in duration-150"
            onClick={() => setIsPopupOpen(false)}
          >
            <div
              className="relative w-full max-w-5xl h-[110vh] bg-neutral-950 border border-neutral-800 rounded-2xl overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header Bar */}
              <div className="px-5 py-3.5 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-950/60 border border-blue-800/60 flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-neutral-100 text-sm truncate flex items-center gap-2">
                      <span>{camera.name}</span>
                      <span className="px-2 py-0.5 rounded bg-blue-950 border border-blue-800 text-[10px] font-mono text-blue-300">
                        LUỒNG CHÍNH (MAIN HD)
                      </span>
                    </h3>
                    {camera.location && (
                      <p className="text-xs text-neutral-400 truncate">{camera.location}</p>
                    )}
                  </div>
                </div>

                {/* Modal Controls (Snapshot, Record, Audio, Reload, Close) */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Snapshot / Capture Button */}
                  <button
                    onClick={() => {
                      if (popupVideoRef.current) {
                        captureFrameLocal(popupVideoRef.current, camera.name);
                      }
                    }}
                    title="Chụp ảnh màn hình (Snapshot)"
                    className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-700 transition flex items-center gap-1.5 text-xs font-medium"
                  >
                    <CameraIcon className="w-4 h-4 text-emerald-400" />
                    <span className="hidden sm:inline">Chụp ảnh</span>
                  </button>

                  {/* Record Button (Unlimited duration until user stops) */}
                  {isRecording ? (
                    <button
                      onClick={toggleRecording}
                      title="Nhấn vào đây để dừng ghi hình và lưu video"
                      className="p-2 rounded-lg bg-red-950/90 border border-red-700 text-red-200 hover:bg-red-900 transition flex items-center gap-1.5 text-xs font-semibold animate-pulse"
                    >
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                      <span>Dừng ghi ({formatRecordTime(recordSeconds)})</span>
                    </button>
                  ) : (
                    <button
                      onClick={toggleRecording}
                      title="Bắt đầu ghi hình (quay không giới hạn thời gian)"
                      className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-700 transition flex items-center gap-1.5 text-xs font-medium"
                    >
                      <VideoIcon className="w-4 h-4 text-red-400" />
                      <span className="hidden sm:inline">Ghi hình</span>
                    </button>
                  )}

                  {/* Audio Mute / Unmute */}
                  <button
                    onClick={() => setAudioEnabled((v) => !v)}
                    title={audioEnabled ? t("cameraFeed.muteAudio") : t("cameraFeed.unmuteAudio")}
                    className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white transition"
                  >
                    {audioEnabled ? (
                      <Volume2 className="w-4 h-4 text-red-400" />
                    ) : (
                      <VolumeX className="w-4 h-4" />
                    )}
                  </button>

                  {/* Reload Stream */}
                  <button
                    onClick={() => setReloadKey((k) => k + 1)}
                    title="Tải lại luồng"
                    className="p-2 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-white transition"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>

                  {/* Close Modal X */}
                  <button
                    onClick={() => setIsPopupOpen(false)}
                    className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white transition"
                    title="Đóng (Esc)"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Video Container */}
              <div className="flex-1 min-h-0 bg-black relative flex items-center justify-center">
                {mainStreamName ? (
                  <Go2RtcPlayer
                    key={`popup-${mainStreamName}-${reloadKey}`}
                    streamName={mainStreamName}
                    active
                    muted={!audioEnabled}
                    videoRef={popupVideoRef}
                    className="w-full h-full object-contain bg-black"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-neutral-500">
                    <span>Không tìm thấy luồng chính HD</span>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
