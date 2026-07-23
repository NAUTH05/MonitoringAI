"use client";

import { api } from "@/lib/api";
import { ApiResponse, Camera, CameraStatus } from "@/types";
import { Loader2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const DEFAULT_HOST = "100.100.1.100";

interface StreamFields {
  host: string;
  name: string;
  rawUrl: string;
}

const emptyStream = (): StreamFields => ({
  host: "",
  name: "",
  rawUrl: "",
});

// Parse a go2rtc playback URL (http://<host>:1984/api/stream.m3u8?src=<name>)
// or a bare stream name back into form fields. Mirrors deriveStreamName in CameraFeed.
function parseStream(url?: string): StreamFields {
  const parsed = emptyStream();
  if (!url) return parsed;

  const value = url.trim();
  const src = value.match(/[?&]src=([^&]+)/);
  if (src) {
    let host = "";
    try {
      host = new URL(value).hostname;
    } catch {
      /* ignore */
    }
    return { host, name: decodeURIComponent(src[1]), rawUrl: "" };
  }
  if (/^[\w.-]+$/.test(value)) return { ...parsed, name: value };
  return { ...parsed, rawUrl: value };
}

function buildStream(fields: StreamFields): string {
  const name = fields.name.trim();
  const raw = fields.rawUrl.trim();
  if (name) {
    const host = fields.host.trim() || DEFAULT_HOST;
    return `http://${host}:1984/api/stream.m3u8?src=${encodeURIComponent(name)}`;
  }
  return raw;
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
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: camera?.name ?? "",
    location: camera?.location ?? "",
    status: (camera?.status ?? "OFFLINE") as CameraStatus,
  });
  const [mainStream, setMainStream] = useState(() => {
    const parsed = parseStream(camera?.rtspUrl);
    return camera ? parsed : { ...parsed, host: DEFAULT_HOST };
  });
  const [subStream, setSubStream] = useState(() => parseStream(camera?.subRtspUrl));

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
    const rtspUrl = buildStream(mainStream);
    if (!rtspUrl) {
      setError(t("cameraForm.mainStreamRequired"));
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...form,
        rtspUrl,
        subRtspUrl: buildStream(subStream) || undefined,
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

  const streamFields = (
    label: string,
    value: StreamFields,
    onChange: (next: StreamFields) => void,
    required = false,
  ) => (
    <div className="space-y-3 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">
          {required ? t("cameraForm.required") : t("cameraForm.optional")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          value={value.host}
          onChange={(e) => onChange({ ...value, host: e.target.value })}
          placeholder="go2rtc host (100.100.1.100)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
        />
        <input
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          required={required && !value.rawUrl}
          placeholder="stream name (C17_D1)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
        />
      </div>
      <input
        value={value.rawUrl}
        onChange={(e) => onChange({ ...value, rawUrl: e.target.value })}
        placeholder={t("cameraForm.rawUrlPlaceholder")}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">
            {isEdit ? t("cameraForm.editTitle") : t("cameraForm.addTitle")}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              {t("cameraForm.nameLabel")}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder={t("cameraForm.namePlaceholder")}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              {t("cameraForm.locationLabel")}
            </label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              required
              placeholder={t("cameraForm.locationPlaceholder")}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            />
          </div>

          {streamFields(t("cameraForm.mainStream"), mainStream, setMainStream, true)}
          {streamFields(t("cameraForm.subStream"), subStream, setSubStream)}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              {t("cameraForm.statusLabel")}
            </label>
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as CameraStatus })
              }
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            >
              <option value="ONLINE">{t("cameras.statusOnline")}</option>
              <option value="OFFLINE">{t("cameras.statusOffline")}</option>
              <option value="ERROR">{t("cameras.statusError")}</option>
            </select>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-3 py-2.5 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
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
              {loading ? t("common.saving") : isEdit ? t("common.saveChanges") : t("cameraForm.addTitle")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
