"use client";

import { api } from "@/lib/api";
import { ApiResponse, Camera, CameraStatus } from "@/types";
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const DEFAULT_GO2RTC_HOST = "100.100.1.100";

interface Go2rtcStream {
  name: string;
  sources: string[];
}

interface StreamInputFields {
  streamName: string;
  useFfmpeg: boolean;
  user: string;
  pass: string;
  host: string;
  channels: string;
  format: string;
  rawUrl: string;
}

const emptyStreamInput = (defaultName = ""): StreamInputFields => ({
  streamName: defaultName,
  useFfmpeg: false,
  user: "",
  pass: "",
  host: "",
  channels: "",
  format: "",
  rawUrl: "",
});

function extractStreamName(url?: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  const m = trimmed.match(/[?&]src=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (/^[\w.-]+$/.test(trimmed)) return trimmed;
  return "";
}

function parseStreamSource(sourceUrl?: string, streamName = ""): StreamInputFields {
  const fields = emptyStreamInput(streamName);
  if (!sourceUrl) return fields;

  const value = sourceUrl.trim();
  const useFfmpeg = /^ffmpeg:/i.test(value);
  const withoutPrefix = value.replace(/^ffmpeg:/i, "");

  if (!withoutPrefix.toLowerCase().startsWith("rtsp://")) {
    return { ...fields, useFfmpeg, rawUrl: value };
  }

  try {
    const u = new URL(withoutPrefix);
    return {
      streamName,
      useFfmpeg,
      user: decodeURIComponent(u.username),
      pass: decodeURIComponent(u.password),
      host: u.host,
      channels: u.pathname.replace(/^\//, ""),
      format: u.hash,
      rawUrl: "",
    };
  } catch {
    return { ...fields, useFfmpeg, rawUrl: value };
  }
}

function buildRtspSource(fields: StreamInputFields): string {
  const raw = fields.rawUrl.trim();
  if (!fields.host.trim()) {
    if (raw) {
      if (fields.useFfmpeg && !/^ffmpeg:/i.test(raw)) return `ffmpeg:${raw}`;
      if (!fields.useFfmpeg && /^ffmpeg:/i.test(raw)) return raw.replace(/^ffmpeg:/i, "");
      return raw;
    }
    return "";
  }

  const user = fields.user.trim();
  const pass = fields.pass.trim();
  const auth = user
    ? `${encodeURIComponent(user)}${pass ? `:${encodeURIComponent(pass)}` : ""}@`
    : "";
  const channels = fields.channels.trim().replace(/^\/+/, "");
  const format = fields.format.trim();
  const suffix = format ? (format.startsWith("#") ? format : `#${format}`) : "";
  const rtspUrl = `rtsp://${auth}${fields.host.trim()}${channels ? `/${channels}` : ""}${suffix}`;

  return fields.useFfmpeg ? `ffmpeg:${rtspUrl}` : rtspUrl;
}

function buildPlaybackUrl(streamName: string, host = DEFAULT_GO2RTC_HOST): string {
  const trimmed = streamName.trim();
  if (!trimmed) return "";
  return `http://${host}:1984/api/stream.m3u8?src=${encodeURIComponent(trimmed)}`;
}

interface Props {
  camera?: Camera;
  onClose: () => void;
  onSuccess: () => void;
}

export function CameraFormDialog({ camera, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const isEdit = !!camera;
  const [loading, setLoading] = useState(false);
  const [fetchingStreams, setFetchingStreams] = useState(false);
  const [error, setError] = useState("");
  const [showSubStream, setShowSubStream] = useState(!!camera?.subRtspUrl);
  const [go2rtcHost, setGo2rtcHost] = useState(DEFAULT_GO2RTC_HOST);

  const [form, setForm] = useState({
    name: camera?.name ?? "",
    location: camera?.location ?? "",
    status: (camera?.status ?? "ONLINE") as CameraStatus,
  });

  const [mainStream, setMainStream] = useState<StreamInputFields>(() => {
    const name = extractStreamName(camera?.rtspUrl);
    return parseStreamSource(undefined, name);
  });

  const [subStream, setSubStream] = useState<StreamInputFields>(() => {
    const name = extractStreamName(camera?.subRtspUrl);
    return parseStreamSource(undefined, name);
  });

  // Fetch go2rtc streams on load to pre-fill RTSP source details if editing
  useEffect(() => {
    let unmounted = false;
    async function loadStreams() {
      setFetchingStreams(true);
      try {
        const res = await api.get<ApiResponse<Go2rtcStream[]>>("/go2rtc/streams");
        if (res.success && !unmounted && Array.isArray(res.data)) {
          const mainName = extractStreamName(camera?.rtspUrl);
          const subName = extractStreamName(camera?.subRtspUrl);

          const mainObj = res.data.find((s) => s.name === mainName);
          if (mainObj && mainObj.sources[0]) {
            setMainStream(parseStreamSource(mainObj.sources[0], mainName));
          } else if (camera?.rtspUrl) {
            setMainStream(parseStreamSource(camera.rtspUrl, mainName));
          }

          const subObj = res.data.find((s) => s.name === subName);
          if (subObj && subObj.sources[0]) {
            setSubStream(parseStreamSource(subObj.sources[0], subName));
            setShowSubStream(true);
          } else if (camera?.subRtspUrl) {
            setSubStream(parseStreamSource(camera.subRtspUrl, subName));
          }
        }
      } catch {
        /* ignore fetch stream error */
      } finally {
        if (!unmounted) setFetchingStreams(false);
      }
    }
    loadStreams();
    return () => {
      unmounted = true;
    };
  }, [camera]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const mainName = mainStream.streamName.trim();
      const mainSrc = buildRtspSource(mainStream);

      if (!mainName && !mainStream.rawUrl) {
        throw new Error("Vui lòng nhập tên luồng chính hoặc Raw URL");
      }

      let finalRtspUrl = "";
      if (mainName && mainSrc) {
        // Automatically add / update stream in go2rtc
        await api.put("/go2rtc/streams", {
          name: mainName,
          src: mainSrc,
        });
        finalRtspUrl = buildPlaybackUrl(mainName, go2rtcHost);
      } else if (mainStream.rawUrl) {
        finalRtspUrl = mainStream.rawUrl;
      }

      if (!finalRtspUrl) {
        throw new Error("Không thể cấu hình luồng chính cho Camera");
      }

      // Sub stream (Optional)
      let finalSubRtspUrl: string | undefined = undefined;
      const subName = subStream.streamName.trim();
      const subSrc = buildRtspSource(subStream);

      if (showSubStream && subName && subSrc) {
        await api.put("/go2rtc/streams", {
          name: subName,
          src: subSrc,
        });
        finalSubRtspUrl = buildPlaybackUrl(subName, go2rtcHost);
      } else if (showSubStream && subStream.rawUrl) {
        finalSubRtspUrl = subStream.rawUrl;
      }

      const payload = {
        ...form,
        rtspUrl: finalRtspUrl,
        subRtspUrl: finalSubRtspUrl || undefined,
      };

      if (isEdit) {
        await api.put<ApiResponse<Camera>>(`/cameras/${camera!.id}`, payload);
      } else {
        await api.post<ApiResponse<Camera>>("/cameras", payload);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cameraForm.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const renderStreamForm = (
    title: string,
    isMain: boolean,
    value: StreamInputFields,
    onChange: (next: StreamInputFields) => void,
  ) => (
    <div className="space-y-3 border border-gray-800 rounded-xl p-4 bg-gray-900/60">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          {title}
          {isMain ? (
            <span className="text-[10px] bg-blue-900/60 text-blue-300 border border-blue-700/50 px-1.5 py-0.5 rounded font-mono">
              Bắt buộc
            </span>
          ) : (
            <span className="text-[10px] bg-gray-800 text-gray-400 border border-gray-700 px-1.5 py-0.5 rounded font-mono">
              Tùy chọn
            </span>
          )}
        </span>
      </div>

      {/* Tên luồng go2rtc */}
      <div>
        <label className="block text-xs text-gray-400 mb-1 font-medium">
          Tên luồng go2rtc {isMain && "*"}
        </label>
        <input
          value={value.streamName}
          onChange={(e) => onChange({ ...value, streamName: e.target.value })}
          required={isMain && !value.rawUrl}
          placeholder={isMain ? "e.g. cam_gate_main" : "e.g. cam_gate_sub"}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
        />
      </div>

      {/* Checkbox FFmpeg Transcode */}
      <label className="flex items-center gap-2 text-xs text-gray-300 font-medium cursor-pointer select-none py-1 border-y border-gray-800/80">
        <input
          type="checkbox"
          checked={value.useFfmpeg}
          onChange={(e) => onChange({ ...value, useFfmpeg: e.target.checked })}
          className="w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-600 focus:ring-offset-gray-900 cursor-pointer"
        />
        <span>Bật FFmpeg Transcode (Tự động thêm tiền tố ffmpeg:)</span>
      </label>

      {/* RTSP Credentials */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">RTSP User</label>
          <input
            value={value.user}
            onChange={(e) => onChange({ ...value, user: e.target.value })}
            placeholder="admin"
            autoComplete="off"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
          />
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">RTSP Password</label>
          <input
            type="password"
            value={value.pass}
            onChange={(e) => onChange({ ...value, pass: e.target.value })}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
          />
        </div>
      </div>

      {/* Host & Channels */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Host & Port</label>
          <input
            value={value.host}
            onChange={(e) => onChange({ ...value, host: e.target.value })}
            placeholder="192.168.1.200:554"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
          />
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-1">Kênh / Channels Path</label>
          <input
            value={value.channels}
            onChange={(e) => onChange({ ...value, channels: e.target.value })}
            placeholder={isMain ? "Streaming/Channels/101" : "Streaming/Channels/102"}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
          />
        </div>
      </div>

      {/* Format Parameters */}
      <div>
        <label className="block text-[11px] text-gray-400 mb-1">Tham số định dạng / Format</label>
        <input
          value={value.format}
          onChange={(e) => onChange({ ...value, format: e.target.value })}
          placeholder="#video=h264 (hoặc #video=h264#raw=-b:v 500k)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
        />
      </div>

      {/* Raw URL fallback */}
      <div>
        <label className="block text-[11px] text-gray-400 mb-1">Hoặc Raw URL trực tiếp</label>
        <input
          value={value.rawUrl}
          onChange={(e) => onChange({ ...value, rawUrl: e.target.value })}
          placeholder="rtsp://... hoặc http://.../stream.m3u8?src=..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs font-mono"
        />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {isEdit ? t("cameraForm.editTitle") : t("cameraForm.addTitle")}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Nhập thông tin camera & tự động đồng bộ luồng go2rtc trong 1 bước
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {fetchingStreams && (
            <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-950/40 border border-blue-800/50 p-2.5 rounded-lg">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Đang tải thông số luồng từ go2rtc...</span>
            </div>
          )}

          {/* Camera Details */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              1. Thông tin cơ bản
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  {t("cameraForm.nameLabel")}
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder={t("cameraForm.namePlaceholder")}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  {t("cameraForm.locationLabel")}
                </label>
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  required
                  placeholder={t("cameraForm.locationPlaceholder")}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  {t("cameraForm.statusLabel")}
                </label>
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as CameraStatus })
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                >
                  <option value="ONLINE">{t("cameras.statusOnline")}</option>
                  <option value="OFFLINE">{t("cameras.statusOffline")}</option>
                  <option value="ERROR">{t("cameras.statusError")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  go2rtc Host IP
                </label>
                <input
                  value={go2rtcHost}
                  onChange={(e) => setGo2rtcHost(e.target.value)}
                  placeholder="100.100.1.100"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
                />
              </div>
            </div>
          </div>

          {/* Main Stream Section */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              2. Cấu hình Luồng Chính (Main Stream)
            </h3>
            {renderStreamForm("Luồng chính", true, mainStream, setMainStream)}
          </div>

          {/* Sub Stream Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                3. Cấu hình Luồng Phụ (Sub Stream)
              </h3>
              <button
                type="button"
                onClick={() => setShowSubStream((v) => !v)}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
              >
                {showSubStream ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" /> Ẩn luồng phụ
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" /> + Thêm luồng phụ (Khuyên dùng)
                  </>
                )}
              </button>
            </div>

            {showSubStream && renderStreamForm("Luồng phụ", false, subStream, setSubStream)}
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-3.5 py-2.5 text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-3 border-t border-gray-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2.5 rounded-lg transition text-sm"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-2 text-sm"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? t("common.saving") : isEdit ? t("common.saveChanges") : "Tạo Camera & Luồng go2rtc"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
