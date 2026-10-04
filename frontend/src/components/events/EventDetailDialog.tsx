"use client";

import {
  cn,
  formatConfidence,
  formatDate,
  getConfidenceColor,
  getEventTypeColor,
} from "@/lib/utils";
import { Event } from "@/types";
import { Download, Image as ImageIcon, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Resolve a possibly-relative media path to an absolute URL. */
function mediaUrl(url: string): string {
  if (!url) return url;
  return url.startsWith("http")
    ? url
    : `${process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"}${url}`;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
}

export function EventDetailDialog({
  event,
  onClose,
}: {
  event: Event;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Evidence collection — falls back to the legacy single imageUrl / videoUrl
  // when an event predates the Evidence model. Nothing is mocked.
  const images = (event.evidence ?? []).filter((e) => e.type === "IMAGE");
  const video = (event.evidence ?? []).find((e) => e.type === "VIDEO");
  const [preview, setPreview] = useState<string | null>(null);
  const primaryUrl = preview ?? images[0]?.url ?? event.imageUrl;
  const hasEvidence = Boolean(primaryUrl || video);

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
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
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

            {!hasEvidence ? (
              <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/60 p-6 flex flex-col items-center justify-center text-center">
                <ImageIcon className="w-8 h-8 text-gray-600 mb-2" />
                <p className="text-xs font-medium text-gray-400">
                  {t("eventDetail.evidenceUnavailable")}
                </p>
              </div>
            ) : (
              <>
                {/* Primary snapshot (large preview) */}
                {primaryUrl && (
                  <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-950 aspect-video relative">
                    <img
                      src={mediaUrl(primaryUrl)}
                      alt={t("eventDetail.evidenceAlt")}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>
                )}

                {/* Snapshot timeline */}
                {images.length > 0 && (
                  <div>
                    <p className="text-[11px] text-gray-500 mb-1.5">
                      {t("eventDetail.snapshots", { count: images.length })}
                    </p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {images.map((ev) => (
                        <button
                          key={ev.id}
                          type="button"
                          onClick={() => setPreview(ev.url)}
                          className={cn(
                            "shrink-0 w-24 rounded-lg overflow-hidden border transition text-left",
                            primaryUrl === ev.url
                              ? "border-blue-500"
                              : "border-gray-800 hover:border-gray-600",
                          )}
                        >
                          <img
                            src={mediaUrl(ev.url)}
                            alt={`#${ev.sequence}`}
                            className="w-full h-16 object-cover bg-gray-950"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                          <span className="block text-[9px] text-gray-400 font-mono py-0.5 px-1 truncate">
                            #{ev.sequence} · {timeOf(ev.capturedAt)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Video */}
                {video && (
                  <div className="rounded-xl overflow-hidden border border-gray-800 bg-gray-950 p-1">
                    <video src={mediaUrl(video.url)} controls className="w-full rounded-lg" />
                  </div>
                )}

                {/* Downloads */}
                <div className="flex gap-2">
                  {primaryUrl && (
                    <a
                      href={mediaUrl(primaryUrl)}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 bg-gray-850 hover:bg-gray-800 text-gray-300 border border-gray-800 px-3 py-2 rounded-lg text-xs transition font-semibold"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-400" />
                      <span>{t("eventDetail.downloadImage")}</span>
                    </a>
                  )}
                  {video && (
                    <a
                      href={mediaUrl(video.url)}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
