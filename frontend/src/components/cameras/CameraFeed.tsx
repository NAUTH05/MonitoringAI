"use client";

import { Camera, Event } from "@/types";
import { AlertTriangle, Activity, Volume2, VolumeX, ShieldAlert, Cpu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

interface CameraFeedProps {
  camera: Camera;
  showScanlines?: boolean;
  activeEvent?: Event | null;
  onClearEvent?: () => void;
  isExpanded?: boolean;
}

// Helper to determine if a URL can be played natively in a browser or via HLS.js
const isWebPlayable = (url: string): boolean => {
  if (!url) return false;
  const lowercase = url.toLowerCase().trim();
  return (
    lowercase.startsWith("http://") ||
    lowercase.startsWith("https://") ||
    lowercase.startsWith("/") ||
    lowercase.startsWith("./") ||
    lowercase.startsWith("../") ||
    lowercase.endsWith(".mp4") ||
    lowercase.endsWith(".webm") ||
    lowercase.endsWith(".ogg") ||
    lowercase.endsWith(".m3u8")
  );
};

export function CameraFeed({
  camera,
  showScanlines = true,
  activeEvent,
  onClearEvent,
}: CameraFeedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(30);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [bitrate, setBitrate] = useState(1.5);
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  // A camera is playable as a real stream only if its URL is web-playable (HLS/MP4/HTTP).
  const playable = isWebPlayable(camera.rtspUrl);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Initialize and play the real video or HLS stream
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playable) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const streamUrl = camera.rtspUrl.trim();
    const isHls = streamUrl.toLowerCase().endsWith(".m3u8") || streamUrl.includes(".m3u8");

    if (isHls) {
      if (Hls.isSupported()) {
        if (hlsRef.current) {
          hlsRef.current.destroy();
        }
        const hls = new Hls({
          maxMaxBufferLength: 10,
          enableWorker: true,
          lowLatencyMode: true,
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch((err) => {
            if (err.name !== "AbortError") console.log("HLS auto-play blocked:", err);
          });
        });

        hls.on(Hls.Events.ERROR, function (event, data) {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log("HLS network error, trying to recover...", data);
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log("HLS media error, trying to recover...", data);
                hls.recoverMediaError();
                break;
              default:
                console.log("HLS fatal error:", data);
                break;
            }
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native HLS fallback (Safari)
        video.src = streamUrl;
        video.play().catch((err) => console.log("Native HLS autoplay blocked:", err));
      }
    } else {
      // Standard video file or HTTP/HTTPS stream
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = streamUrl;
      video.load();
      video.play().catch((err) => {
        if (err.name !== "AbortError") console.log("Video autoplay blocked:", err);
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [camera.rtspUrl, playable]);

  // Sync mute state of the video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = !audioEnabled;
    }
  }, [audioEnabled]);

  // Audio Buzzer logic on AI alert trigger
  const playBuzzer = () => {
    if (!audioEnabled) return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
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
    } catch (e) {
      console.warn("Audio Context error:", e);
    }
  };

  // Play alarm buzzer once when an alert is active and audio enabled
  useEffect(() => {
    if (activeEvent && activeEvent.isAlert) {
      playBuzzer();
      const buzzerInterval = setInterval(playBuzzer, 1200);
      return () => clearInterval(buzzerInterval);
    }
  }, [activeEvent, audioEnabled]);

  // Auto clear active event highlight after 6 seconds
  useEffect(() => {
    if (activeEvent) {
      const timer = setTimeout(() => {
        if (onClearEvent) onClearEvent();
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [activeEvent, onClearEvent]);

  // Update dynamic bitrate readout
  useEffect(() => {
    if (camera.status !== "ONLINE") return;
    const interval = setInterval(() => {
      setBitrate(parseFloat((1.2 + Math.random() * 0.8).toFixed(2)));
    }, 4000);
    return () => clearInterval(interval);
  }, [camera.status]);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const render = (timestamp: number) => {
      frameCountRef.current++;
      if (timestamp - lastFpsUpdateRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = timestamp;
      }

      const width = canvas.width;
      const height = canvas.height;

      // 1. Draw Offline / Error state static noise
      if (camera.status === "OFFLINE" || camera.status === "ERROR") {
        ctx.fillStyle = "#090d16";
        ctx.fillRect(0, 0, width, height);

        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const val = Math.random() > 0.5 ? 25 : 0;
          data[i] = val + 15;
          data[i + 1] = val + 20;
          data[i + 2] = val + 35;
          data[i + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);

        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "#9ca3af";
        ctx.font = "bold 13px Courier New";
        ctx.fillText(`CAM: ${camera.name} - ${camera.location}`, 20, 30);
        ctx.fillText(`STATUS: ${camera.status}`, 20, 50);

        ctx.fillStyle = camera.status === "ERROR" ? "#f87171" : "#6b7280";
        ctx.font = "bold 20px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          camera.status === "ERROR" ? "▲ SIGNAL FAULT / HW ERROR" : "☒ CONNECTION LOST / OFFLINE",
          width / 2,
          height / 2
        );
        ctx.textAlign = "left";

        ctx.strokeStyle = "rgba(255, 0, 0, 0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(width, height);
        ctx.moveTo(width, 0);
        ctx.lineTo(0, height);
        ctx.stroke();

        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // 2. Render the real stream frame, or connection guidance for rtsp:// URLs
      let drawVideoFrame = false;
      if (playable && videoRef.current) {
        const video = videoRef.current;
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          ctx.drawImage(video, 0, 0, width, height);
          drawVideoFrame = true;
        } else {
          ctx.fillStyle = "#090d16";
          ctx.fillRect(0, 0, width, height);

          ctx.fillStyle = "#64748b";
          ctx.font = "bold 13px monospace";
          ctx.textAlign = "center";
          ctx.fillText("⚡ CONNECTING STREAM...", width / 2, height / 2);
          ctx.textAlign = "left";
          drawVideoFrame = true;
        }
      }

      if (!drawVideoFrame) {
        // Non web-playable URL (raw rtsp://): show real setup guidance to add a stream gateway.
        const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, width);
        bgGrad.addColorStop(0, "#0b132b");
        bgGrad.addColorStop(1, "#020617");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "#f87171";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("⚠️ RTSP DIRECT STREAM UNSUPPORTED", width / 2, height / 2 - 40);

        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px sans-serif";
        ctx.fillText("Web browsers cannot play rtsp:// streams directly.", width / 2, height / 2 - 15);
        ctx.fillText("Run a stream gateway (go2rtc / FFmpeg) to convert RTSP → HLS,", width / 2, height / 2 + 5);
        ctx.fillText("then set the camera URL to the .m3u8 / HTTP stream.", width / 2, height / 2 + 25);

        ctx.fillStyle = "#3b82f6";
        ctx.font = "bold 11px monospace";
        ctx.fillText("See STREAM_GATEWAY.md for setup instructions", width / 2, height / 2 + 55);
        ctx.textAlign = "left";
      }

      // 3. Draw Real-Time Socket Warning overlay when a real event is active
      if (activeEvent) {
        ctx.save();

        const borderGlow = Math.abs(Math.sin(timestamp * 0.007));
        ctx.strokeStyle = `rgba(239, 68, 68, ${borderGlow})`;
        ctx.lineWidth = 6;
        ctx.strokeRect(0, 0, width, height);

        if (Math.floor(timestamp / 300) % 2 === 0) {
          ctx.fillStyle = "rgba(239, 68, 68, 0.95)";
          ctx.fillRect(0, 45, width, 30);

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 13px Courier New";
          ctx.textAlign = "center";
          ctx.fillText(
            `⚠️ ALERT: [${activeEvent.eventType}] DETECTED - CONFIDENCE ${(activeEvent.confidence * 100).toFixed(0)}%`,
            width / 2,
            64
          );
        }
        ctx.restore();
      }

      // 4. Draw Scanline Interlacing Effect
      if (showScanlines) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
        for (let y = 0; y < height; y += 4) {
          ctx.fillRect(0, y, width, 1.5);
        }
      }

      // 5. Draw HUD Elements (header/footer bars)
      ctx.fillStyle = "rgba(15, 23, 42, 0.8)";
      ctx.fillRect(0, 0, width, 45);

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 12px Courier New";
      ctx.textAlign = "left";
      ctx.fillText(camera.name, 15, 20);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px monospace";
      ctx.fillText(`${camera.location} // LIVE STREAM`, 15, 33);

      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      ctx.arc(width - 120, 16, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#e2e8f0";
      ctx.font = "10px Courier New";
      ctx.fillText("LIVE FEED", width - 110, 20);

      ctx.fillStyle = "#64748b";
      ctx.font = "9px monospace";
      if (playable && videoRef.current) {
        const video = videoRef.current;
        const widthVal = video.videoWidth || 1920;
        const heightVal = video.videoHeight || 1080;
        ctx.fillText(`FPS: ${fps} | RES: ${widthVal}x${heightVal}`, width - 200, 33);
      } else {
        ctx.fillText(`FPS: ${fps} | AWAITING GATEWAY`, width - 200, 33);
      }
      ctx.fillText(`${bitrate.toFixed(1)} Mbps | H.265`, width - 110, 33);

      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(0, height - 25, width, 25);

      const now = new Date();
      const timeStr = now.toLocaleTimeString("vi-VN", { hour12: false });
      const dateStr = now.toLocaleDateString("vi-VN");

      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${dateStr} ${timeStr}`, width - 15, height - 8);

      ctx.textAlign = "left";
      ctx.fillStyle = activeEvent && activeEvent.isAlert ? "#ef4444" : "#3b82f6";
      ctx.fillText(
        activeEvent && activeEvent.isAlert ? "🚨 AI WARNING EVENT ACTIVE" : "🛡️ SECURITY INTELLIGENCE FEED",
        15,
        height - 8
      );

      if (Math.floor(timestamp / 500) % 2 === 0) {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(width - 240, 16, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ef4444";
        ctx.font = "bold 9px monospace";
        ctx.fillText("REC", width - 232, 19);
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [camera, showScanlines, activeEvent, fps, bitrate, playable]);

  return (
    <div
      className={`relative rounded-xl overflow-hidden border transition-all duration-300 bg-gray-950 flex flex-col group ${
        activeEvent
          ? activeEvent.isAlert
            ? "border-red-600 shadow-[0_0_15px_rgba(239,68,68,0.3)]"
            : "border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.3)]"
          : "border-gray-800 hover:border-gray-700"
      }`}
    >
      {/* Canvas Video Stream Container */}
      <div className="relative flex-1 aspect-video w-full bg-slate-950">
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="w-full h-full object-cover"
        />

        {/* Hidden HTML5 Video element for background drawing */}
        {playable && (
          <video
            ref={videoRef}
            playsInline
            muted
            loop
            style={{ display: "none" }}
          />
        )}

        {/* Audio toggle inside the stream */}
        {camera.status === "ONLINE" && (
          <div className="absolute left-3 bottom-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={() => setAudioEnabled(!audioEnabled)}
              title={audioEnabled ? "Mute alarm buzzer" : "Unmute alarm buzzer"}
              className="p-1.5 rounded-lg bg-gray-900/80 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-800"
            >
              {audioEnabled ? <Volume2 className="w-3.5 h-3.5 text-red-400" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* Active event status overlay */}
        {activeEvent && (
          <div
            className={`absolute top-14 left-4 right-4 p-2 rounded-lg border text-xs font-semibold flex items-center justify-between animate-pulse ${
              activeEvent.isAlert
                ? "bg-red-950/85 border-red-800 text-red-200"
                : "bg-orange-950/85 border-orange-800 text-orange-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
              <div>
                <span className="font-bold uppercase">{activeEvent.eventType} DETECTED</span>
                <p className="text-[10px] text-gray-300 font-normal">Confidence: {(activeEvent.confidence * 100).toFixed(1)}%</p>
              </div>
            </div>
            <button
              onClick={onClearEvent}
              className="px-2 py-1 bg-red-800 hover:bg-red-700 text-white rounded text-[10px]"
            >
              Acknowledge
            </button>
          </div>
        )}
      </div>

      {/* Camera Panel Info Bar */}
      <div className="p-3 bg-gray-900 border-t border-gray-800 flex items-center justify-between text-xs">
        <div className="min-w-0">
          <p className="font-medium text-white truncate">{camera.name}</p>
          <p className="text-gray-400 truncate text-[11px]">{camera.location}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {camera.status === "ONLINE" ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
              <Activity className="w-3 h-3 animate-pulse" />
              Active
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                camera.status === "ERROR"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-gray-500/10 text-gray-400 border-gray-500/20"
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              {camera.status}
            </span>
          )}

          {camera.cameraModules && camera.cameraModules.length > 0 && (
            <div className="flex gap-0.5" title={`${camera.cameraModules.length} AI Modules enabled`}>
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-gray-400 text-[10px] font-bold">{camera.cameraModules.length}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
