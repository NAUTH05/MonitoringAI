"use client";

import {
  cn,
  formatConfidence,
  formatDate,
  getConfidenceColor,
  getEventTypeColor,
} from "@/lib/utils";
import { Event } from "@/types";
import { Download, Image, Video, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export function EventDetailDialog({
  event,
  onClose,
}: {
  event: Event;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "px-2.5 py-1 rounded-full text-xs font-medium border",
                getEventTypeColor(event.eventType),
              )}
            >
              {event.eventType}
            </span>
            <h2 className="text-base font-semibold text-white">{t("eventDetail.title")}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs mb-1">{t("eventDetail.eventId")}</p>
              <p className="text-white font-mono text-xs">
                {event.id.slice(0, 8)}...
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs mb-1">{t("eventDetail.camera")}</p>
              <p className="text-white text-xs">{event.camera?.name}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs mb-1">{t("eventDetail.location")}</p>
              <p className="text-white text-xs">{event.camera?.location}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-400 text-xs mb-1">{t("eventDetail.confidence")}</p>
              <p
                className={cn(
                  "text-xs font-semibold",
                  getConfidenceColor(event.confidence),
                )}
              >
                {formatConfidence(event.confidence)}
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 col-span-2">
              <p className="text-gray-400 text-xs mb-1">{t("eventDetail.timestamp")}</p>
              <p className="text-white text-xs">
                {formatDate(event.timestamp)}
              </p>
            </div>
          </div>

          {/* Alert status */}
          {event.isAlert && (
            <div className="bg-red-900/20 border border-red-800/50 rounded-lg px-4 py-3">
              <p className="text-red-400 text-sm font-medium">
                🚨 {t("eventDetail.highConfidenceAlert")}
              </p>
              <p className="text-red-300/70 text-xs mt-1">
                {t("eventDetail.status", { status: event.alert?.status ?? t("eventDetail.statusUnread") })}
              </p>
            </div>
          )}

          {/* Evidence */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {t("eventDetail.evidenceViewer")}
            </p>
            
            {/* Inline Media Displays */}
            <div className="space-y-3">
              {event.imageUrl && (
                <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-950 aspect-video relative group">
                  <img
                    src={event.imageUrl}
                    alt={t("eventDetail.evidenceAlt")}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      // Fallback if the image doesn't exist yet on disk
                      (e.target as HTMLElement).style.display = "none";
                      const sibling = (e.target as HTMLElement).nextElementSibling;
                      if (sibling) sibling.classList.remove("hidden");
                    }}
                  />
                  {/* Fallback mockup canvas or placeholder if the image fails to load */}
                  <div className="hidden absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-gray-500">
                    <Image className="w-8 h-8 text-gray-600 mb-2" />
                    <p className="text-xs font-medium">{t("eventDetail.snapshotUnavailable")}</p>
                    <p className="text-[10px] text-gray-600">{t("eventDetail.filePath", { path: event.imageUrl })}</p>
                  </div>
                </div>
              )}

              {event.videoUrl && (
                <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-950 p-1">
                  <video
                    src={event.videoUrl}
                    controls
                    className="w-full rounded-lg"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                      const sibling = (e.target as HTMLElement).nextElementSibling;
                      if (sibling) sibling.classList.remove("hidden");
                    }}
                  />
                  <div className="hidden flex-col items-center justify-center p-6 text-center text-gray-500">
                    <Video className="w-8 h-8 text-gray-600 mb-2" />
                    <p className="text-xs font-medium">{t("eventDetail.videoOffline")}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Download Links */}
            <div className="flex gap-2">
              {event.imageUrl && (
                <a
                  href={event.imageUrl.startsWith("http") ? event.imageUrl : `${process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"}${event.imageUrl}`}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-850 hover:bg-gray-800 text-gray-300 border border-gray-800 px-3 py-2 rounded-lg text-xs transition font-semibold"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  <span>{t("eventDetail.downloadImage")}</span>
                </a>
              )}
              {event.videoUrl && (
                <a
                  href={event.videoUrl.startsWith("http") ? event.videoUrl : `${process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"}${event.videoUrl}`}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-850 hover:bg-gray-800 text-gray-300 border border-gray-800 px-3 py-2 rounded-lg text-xs transition font-semibold"
                >
                  <Download className="w-3.5 h-3.5 text-green-400" />
                  <span>{t("eventDetail.downloadVideo")}</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
