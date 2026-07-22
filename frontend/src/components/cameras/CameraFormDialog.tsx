"use client";

import { api } from "@/lib/api";
import { ApiResponse, Camera, CameraStatus } from "@/types";
import { Loader2, X } from "lucide-react";
import { FormEvent, MouseEvent, useState } from "react";

interface StreamFields {
  user: string;
  pass: string;
  host: string;
  channels: string;
  format: string;
  rawUrl: string;
}

const emptyStream = (): StreamFields => ({
  user: "",
  pass: "",
  host: "",
  channels: "",
  format: "",
  rawUrl: "",
});

function parseStream(url?: string): StreamFields {
  const parsed = emptyStream();
  if (!url) return parsed;

  const value = url.trim();
  const withoutPrefix = value.replace(/^ffmpeg:/i, "");
  if (!withoutPrefix.toLowerCase().startsWith("rtsp://")) {
    return { ...parsed, rawUrl: value };
  }

  try {
    const u = new URL(withoutPrefix);
    return {
      user: decodeURIComponent(u.username),
      pass: decodeURIComponent(u.password),
      host: u.host,
      channels: u.pathname.replace(/^\//, ""),
      format: u.hash,
      rawUrl: "",
    };
  } catch {
    return { ...parsed, rawUrl: value };
  }
}

function buildStream(fields: StreamFields): string {
  const raw = fields.rawUrl.trim();
  if (!fields.host.trim()) return raw;

  const user = fields.user.trim();
  const pass = fields.pass.trim();
  const auth = user
    ? `${encodeURIComponent(user)}${pass ? `:${encodeURIComponent(pass)}` : ""}@`
    : "";
  const channels = fields.channels.trim().replace(/^\/+/, "");
  const format = fields.format.trim();
  const suffix = format ? (format.startsWith("#") ? format : `#${format}`) : "";
  return `rtsp://${auth}${fields.host.trim()}${channels ? `/${channels}` : ""}${suffix}`;
}

interface Props {
  camera?: Camera;
  onClose: () => void;
  onSuccess: () => void;
}

export function CameraFormDialog({ camera, onClose, onSuccess }: Props) {
  const isEdit = !!camera;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: camera?.name ?? "",
    location: camera?.location ?? "",
    status: (camera?.status ?? "OFFLINE") as CameraStatus,
  });
  const [mainStream, setMainStream] = useState(() => parseStream(camera?.rtspUrl));
  const [subStream, setSubStream] = useState(() => parseStream(camera?.subRtspUrl));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const rtspUrl = buildStream(mainStream);
    if (!rtspUrl) {
      setError("Main stream is required");
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
      setError(err instanceof Error ? err.message : "Failed to save camera");
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
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
          {required ? "Required" : "Optional"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          value={value.user}
          onChange={(e) => onChange({ ...value, user: e.target.value })}
          placeholder="user"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
        />
        <input
          type="password"
          value={value.pass}
          onChange={(e) => onChange({ ...value, pass: e.target.value })}
          placeholder="pass"
          autoComplete="new-password"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
        />
      </div>
      <input
        value={value.host}
        onChange={(e) => onChange({ ...value, host: e.target.value })}
        required={required && !value.rawUrl}
        placeholder="host:554"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
      />
      <div className="grid grid-cols-2 gap-3">
        <input
          value={value.channels}
          onChange={(e) => onChange({ ...value, channels: e.target.value })}
          placeholder="channels/101"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
        />
        <input
          value={value.format}
          onChange={(e) => onChange({ ...value, format: e.target.value })}
          placeholder="#video=h264"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
        />
      </div>
      <input
        value={value.rawUrl}
        onChange={(e) => onChange({ ...value, rawUrl: e.target.value })}
        placeholder="Raw URL nếu không phải RTSP chuẩn"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
      />
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">
            {isEdit ? "Edit Camera" : "Add Camera"}
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
              Camera Name *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. CAM-001"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Location *
            </label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              required
              placeholder="e.g. Main Entrance"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            />
          </div>

          {streamFields("Main Stream", mainStream, setMainStream, true)}
          {streamFields("Sub Stream", subStream, setSubStream)}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Status
            </label>
            <select
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as CameraStatus })
              }
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
            >
              <option value="ONLINE">Online</option>
              <option value="OFFLINE">Offline</option>
              <option value="ERROR">Error</option>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-2 text-sm"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Saving..." : isEdit ? "Save Changes" : "Add Camera"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
