"use client";

import { connectSocket, getSocket } from "@/lib/socket";
import { formatDate } from "@/lib/utils";
import { Alert, Event } from "@/types";
import {
  AlertTriangle,
  Car,
  Eye,
  Flame,
  Shield,
  ShieldAlert,
  UserCheck,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type AlertPayload = Alert & { event: Event };

const eventIcons: Record<string, React.ReactNode> = {
  INTRUSION: <AlertTriangle className="w-4 h-4" />,
  FIRE: <Flame className="w-4 h-4" />,
  SMOKE: <Eye className="w-4 h-4" />,
  PPE: <Shield className="w-4 h-4" />,
  FACE: <UserCheck className="w-4 h-4" />,
  VEHICLE: <Car className="w-4 h-4" />,
  FLOOD: <Eye className="w-4 h-4" />,
  TRAFFIC_VIOLATION: <ShieldAlert className="w-4 h-4" />,
};

const eventColors: Record<string, string> = {
  INTRUSION: "border-red-600/60 bg-red-950/90 shadow-red-950/50",
  FIRE: "border-orange-600/60 bg-orange-950/90 shadow-orange-950/50",
  SMOKE: "border-yellow-600/60 bg-yellow-950/90 shadow-yellow-950/50",
  PPE: "border-blue-600/60 bg-blue-950/90 shadow-blue-950/50",
  FACE: "border-purple-600/60 bg-purple-950/90 shadow-purple-950/50",
  VEHICLE: "border-emerald-600/60 bg-emerald-950/90 shadow-emerald-950/50",
  FLOOD: "border-cyan-600/60 bg-cyan-950/90 shadow-cyan-950/50",
  TRAFFIC_VIOLATION: "border-rose-600/60 bg-rose-950/90 shadow-rose-950/50",
};

const textColors: Record<string, string> = {
  INTRUSION: "text-red-400",
  FIRE: "text-orange-400",
  SMOKE: "text-yellow-400",
  PPE: "text-blue-400",
  FACE: "text-purple-400",
  VEHICLE: "text-emerald-400",
  FLOOD: "text-cyan-400",
  TRAFFIC_VIOLATION: "text-rose-400",
};

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<AlertPayload[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Web Audio API synth chime alert sound
  const playAlertSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const playTone = (freq: number, startTime: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + startTime);
        osc.stop(ctx.currentTime + startTime + duration);
      };

      playTone(880, 0, 0.15); // A5 tone
      playTone(1174.66, 0.15, 0.25); // D6 tone
    } catch {
      /* Audio context blocked by browser policy until user gesture */
    }
  }, [soundEnabled]);

  const handleNewAlert = useCallback(
    (data: AlertPayload) => {
      setToasts((prev) => [data, ...prev].slice(0, 5));
      playAlertSound();
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== data.id));
      }, 9000);
    },
    [playAlertSound],
  );

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    connectSocket();
    const socket = getSocket();
    socket.on("new-alert", handleNewAlert);

    return () => {
      socket.off("new-alert", handleNewAlert);
    };
  }, [handleNewAlert]);

  const remove = (id: string) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  return (
    <>
      {children}
      <div className="fixed top-20 right-5 z-50 space-y-3 pointer-events-none max-w-sm w-full">
        {toasts.length > 0 && (
          <div className="flex justify-end pointer-events-auto pr-1">
            <button
              onClick={() => setSoundEnabled((prev) => !prev)}
              className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-neutral-900/90 border border-neutral-700 text-neutral-300 hover:text-white flex items-center gap-1.5 backdrop-blur shadow"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5 text-neutral-500" />}
              <span>{soundEnabled ? "Âm thanh cảnh báo: Bật" : "Âm thanh: Tắt"}</span>
            </button>
          </div>
        )}

        {toasts.map((toast) => {
          const eventType = toast.event?.eventType ?? "INTRUSION";
          const color = eventColors[eventType] || "border-gray-700 bg-gray-900/90";
          const textColor = textColors[eventType] || "text-gray-400";
          const icon = eventIcons[eventType] || <AlertTriangle className="w-4 h-4" />;

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto border rounded-xl p-3.5 max-w-sm shadow-2xl backdrop-blur-md transition duration-200 ${color}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 p-1.5 rounded-lg bg-neutral-950/50 flex-shrink-0 ${textColor}`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`font-bold text-xs uppercase tracking-wider ${textColor}`}>
                      {t("alertToast.alertTitle", { type: eventType })}
                    </p>
                    <span className="text-[10px] font-mono text-neutral-400">
                      {((toast.event?.confidence ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>

                  <p className="text-neutral-100 text-xs font-semibold mt-1 truncate">
                    {toast.event?.camera?.name ?? t("alertToast.unknownCamera")}
                  </p>
                  {toast.event?.camera?.location && (
                    <p className="text-neutral-400 text-[11px]">
                      Vị trí: {toast.event.camera.location}
                    </p>
                  )}

                  {toast.event?.imageUrl && (
                    <div className="mt-2 w-full h-20 bg-neutral-950 rounded-lg overflow-hidden border border-neutral-800 relative">
                      <img
                        src={toast.event.imageUrl}
                        alt={eventType}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <p className="text-neutral-400 text-[10px] font-mono mt-1.5">
                    {toast.event?.timestamp ? formatDate(toast.event.timestamp) : ""}
                  </p>
                </div>

                <button
                  onClick={() => remove(toast.id)}
                  className="text-neutral-400 hover:text-white p-1 rounded-md hover:bg-neutral-800 transition flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

