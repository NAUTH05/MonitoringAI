"use client";

import { api } from "@/lib/api";
import { ApiResponse } from "@/types";
import { Loader2, Pencil, Plus, Radio, RefreshCw, Trash2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

interface Go2rtcStream {
  name: string;
  sources: string[];
}

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
  if (!withoutPrefix.toLowerCase().startsWith("rtsp://")) return { ...parsed, rawUrl: value };

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

export default function StreamsPage() {
  const [streams, setStreams] = useState<Go2rtcStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editStream, setEditStream] = useState<Go2rtcStream | undefined>();

  const fetchStreams = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<ApiResponse<Go2rtcStream[]>>("/go2rtc/streams");
      if (res.success) setStreams(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load streams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStreams();
  }, [fetchStreams]);

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete stream "${name}"?`)) return;
    try {
      await api.delete(`/go2rtc/streams?src=${encodeURIComponent(name)}`);
      fetchStreams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete stream");
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">go2rtc Streams</h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage go2rtc stream mappings from the UI, no yaml editing required
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchStreams}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => {
              setEditStream(undefined);
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Stream
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="px-4 py-3 font-medium">Stream Name</th>
              <th className="px-4 py-3 font-medium">Source(s)</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin inline" />
                </td>
              </tr>
            ) : streams.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-gray-500">
                  <Radio className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No streams configured yet
                </td>
              </tr>
            ) : (
              streams.map((s) => (
                <tr
                  key={s.name}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 transition"
                >
                  <td className="px-4 py-3 font-medium text-white">{s.name}</td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {s.sources.length === 0 ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <span className="text-xs text-gray-500">Hidden</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => {
                          setEditStream(s);
                          setShowForm(true);
                        }}
                        className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(s.name)}
                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <StreamFormDialog
          stream={editStream}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            fetchStreams();
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  stream?: Go2rtcStream;
  onClose: () => void;
  onSuccess: () => void;
}

function StreamFormDialog({ stream, onClose, onSuccess }: DialogProps) {
  const isEdit = !!stream;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: stream?.name ?? "",
  });
  const [streamFields, setStreamFields] = useState(() => parseStream(stream?.sources[0]));

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
      // PUT overwrites by name, so it handles both add and edit.
      await api.put<ApiResponse<unknown>>("/go2rtc/streams", {
        name: form.name,
        src: buildStream(streamFields),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stream");
    } finally {
      setLoading(false);
    }
  };

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
            {isEdit ? "Edit Stream" : "Add Stream"}
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
              Stream Name *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              disabled={isEdit}
              placeholder="e.g. nvr_ch1"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {isEdit && (
              <p className="text-[11px] text-gray-500 mt-1">
                Name is fixed. To rename, delete and create a new stream.
              </p>
            )}
          </div>

          <div>
            <div className="space-y-3 border border-gray-800 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={streamFields.user}
                  onChange={(e) => setStreamFields({ ...streamFields, user: e.target.value })}
                  placeholder="user"
                  autoComplete="off"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
                />
                <input
                  type="password"
                  value={streamFields.pass}
                  onChange={(e) => setStreamFields({ ...streamFields, pass: e.target.value })}
                  placeholder="pass"
                  autoComplete="new-password"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
                />
              </div>
              <input
                value={streamFields.host}
                onChange={(e) => setStreamFields({ ...streamFields, host: e.target.value })}
                placeholder="host:554"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={streamFields.channels}
                  onChange={(e) => setStreamFields({ ...streamFields, channels: e.target.value })}
                  placeholder="channels/101"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
                />
                <input
                  value={streamFields.format}
                  onChange={(e) => setStreamFields({ ...streamFields, format: e.target.value })}
                  placeholder="#video=h264"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
                />
              </div>
              <input
                value={streamFields.rawUrl}
                onChange={(e) => setStreamFields({ ...streamFields, rawUrl: e.target.value })}
                placeholder="Raw URL nếu không nhập theo cấu trúc"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm font-mono"
              />
            </div>
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
              {loading ? "Saving..." : isEdit ? "Save Changes" : "Add Stream"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
