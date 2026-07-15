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
  UserCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type AlertPayload = Alert & { event: Event };

const eventIcons: Record<string, React.ReactNode> = {
  INTRUSION: <AlertTriangle className="w-4 h-4" />,
  FIRE: <Flame className="w-4 h-4" />,
  SMOKE: <Eye className="w-4 h-4" />,
  PPE: <Shield className="w-4 h-4" />,
  FACE: <UserCheck className="w-4 h-4" />,
  VEHICLE: <Car className="w-4 h-4" />,
};

const eventColors: Record<string, string> = {
  INTRUSION: "border-red-600/50 bg-red-950/80",
  FIRE: "border-orange-600/50 bg-orange-950/80",
  SMOKE: "border-yellow-600/50 bg-yellow-950/80",
  PPE: "border-blue-600/50 bg-blue-950/80",
  FACE: "border-purple-600/50 bg-purple-950/80",
  VEHICLE: "border-green-600/50 bg-green-950/80",
};

const textColors: Record<string, string> = {
  INTRUSION: "text-red-400",
  FIRE: "text-orange-400",
  SMOKE: "text-yellow-400",
  PPE: "text-blue-400",
  FACE: "text-purple-400",
  VEHICLE: "text-green-400",
};

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<AlertPayload[]>([]);

  const handleNewAlert = useCallback((data: AlertPayload) => {
    setToasts((prev) => [data, ...prev].slice(0, 5));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== data.id));
    }, 8000);
  }, []);

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
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        {toasts.map((toast) => {
          const eventType = toast.event?.eventType ?? "INTRUSION";
          const color =
            eventColors[eventType] || "border-gray-700 bg-gray-900/80";
          const textColor = textColors[eventType] || "text-gray-400";
          const icon = eventIcons[eventType];

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto border rounded-xl p-4 max-w-xs shadow-2xl backdrop-blur-sm animate-slide-in ${color}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex-shrink-0 ${textColor}`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-semibold text-sm ${textColor}`}>
                    {eventType} Alert
                  </p>
                  <p className="text-gray-300 text-xs mt-0.5 truncate">
                    {toast.event?.camera?.name ?? "Unknown camera"}
                  </p>
                  <p className="text-gray-400 text-xs">
                    Confidence:{" "}
                    {((toast.event?.confidence ?? 0) * 100).toFixed(1)}%
                  </p>
                  <p className="text-gray-500 text-xs mt-1">
                    {toast.event?.timestamp
                      ? formatDate(toast.event.timestamp)
                      : ""}
                  </p>
                </div>
                <button
                  onClick={() => remove(toast.id)}
                  className="text-gray-500 hover:text-gray-200 transition flex-shrink-0"
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
