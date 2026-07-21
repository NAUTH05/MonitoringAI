"use client";

import { CameraFeed } from "@/components/cameras/CameraFeed";
import { useSocket } from "@/hooks/useSocket";
import { api } from "@/lib/api";
import {
  captureFrameLocal,
  captureFrameServer,
  recordLocal,
  recordServer,
} from "@/lib/capture";
import { liveCache } from "@/lib/liveCache";
import { formatDate } from "@/lib/utils";
import { Camera, CameraStatus, Event } from "@/types";
import {
  AlertTriangle,
  Camera as CameraIcon,
  GripVertical,
  Grid2x2,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layout, Layouts, Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

// Breakpoint column counts and the default footprint a fresh camera takes.
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;
const DEFAULT_W = { lg: 4, md: 5, sm: 3, xs: 4, xxs: 2 } as const;
const DEFAULT_H = 4;
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
type BP = keyof typeof COLS;

// Build a fresh layout for a breakpoint, flowing cameras left-to-right.
function buildDefault(bp: BP, cameras: Camera[]): Layout[] {
  const cols = COLS[bp];
  const w = DEFAULT_W[bp];
  const perRow = Math.max(1, Math.floor(cols / w));
  return cameras.map((cam, idx) => ({
    i: cam.id,
    x: (idx % perRow) * w,
    y: Math.floor(idx / perRow) * DEFAULT_H,
    w,
    h: DEFAULT_H,
  }));
}

// Merge a saved layout with the live camera list so existing arrangements
// survive when cameras are added or removed.
function mergeLayouts(saved: Layouts | null, cameras: Camera[]): Layouts {
  const result = {} as Layouts;
  (Object.keys(COLS) as BP[]).forEach((bp) => {
    const savedItems = saved?.[bp] ?? [];
    const byId = new Map(savedItems.map((it) => [it.i, it]));
    const kept: Layout[] = [];

    // Keep saved positions for cameras that still exist.
    cameras.forEach((cam) => {
      const existing = byId.get(cam.id);
      if (existing) kept.push({ ...existing, i: cam.id });
    });

    // Append any new cameras below the current arrangement.
    const missing = cameras.filter((cam) => !byId.has(cam.id));
    if (missing.length) {
      const maxY = kept.reduce((m, it) => Math.max(m, it.y + it.h), 0);
      const cols = COLS[bp];
      const w = DEFAULT_W[bp];
      const perRow = Math.max(1, Math.floor(cols / w));
      missing.forEach((cam, idx) => {
        kept.push({
          i: cam.id,
          x: (idx % perRow) * w,
          y: maxY + Math.floor(idx / perRow) * DEFAULT_H,
          w,
          h: DEFAULT_H,
        });
      });
    }
    result[bp] = kept.length ? kept : buildDefault(bp, cameras);
  });
  return result;
}

// Pull the go2rtc stream name out of a camera URL (mirrors CameraFeed).
function streamNameOf(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/[?&]src=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (url.startsWith("rtsp://")) return null;
  if (/^[\w.-]+$/.test(url.trim())) return url.trim();
  return null;
}

export default function LiveViewPage() {
  // Seed from module cache so returning to /live paints instantly (no cold-start).
  const [cameras, setCameras] = useState<Camera[]>(() => liveCache.getCameras() ?? []);
  const [loading, setLoading] = useState(() => liveCache.getCameras() === null);
  const [error, setError] = useState("");

  const [layouts, setLayouts] = useState<Layouts | null>(() => liveCache.getLayouts());
  const savedLayoutRef = useRef<Layouts | null>(liveCache.getLayouts());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeEvents, setActiveEvents] = useState<Record<string, Event>>({});
  const [eventLog, setEventLog] = useState<Event[]>([]);
  const [showFeed, setShowFeed] = useState(true);
  const [uniform, setUniform] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  // Live <video> elements by camera id, for capture/record.
  const videoEls = useRef<Record<string, HTMLVideoElement | null>>({});
  const registerVideo = useCallback((id: string, el: HTMLVideoElement | null) => {
    videoEls.current[id] = el;
  }, []);

  // Restore preferences.
  useEffect(() => {
    setShowFeed(localStorage.getItem("liveShowFeed") !== "0");
    setUniform(localStorage.getItem("liveUniform") === "1");
  }, []);

  const toggleFeed = useCallback(() => {
    setShowFeed((prev) => {
      const next = !prev;
      localStorage.setItem("liveShowFeed", next ? "1" : "0");
      return next;
    });
  }, []);

  const toggleUniform = useCallback(() => {
    setUniform((prev) => {
      const next = !prev;
      localStorage.setItem("liveUniform", next ? "1" : "0");
      return next;
    });
  }, []);

  const fetchCameras = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: Camera[] }>(
        "/cameras?limit=100",
      );
      if (res.success) {
        setCameras(res.data);
        liveCache.setCameras(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cameras");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRecentEvents = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: Event[] }>(
        "/events?limit=25",
      );
      if (res.success) setEventLog(res.data);
    } catch (err) {
      console.error("Failed to load historical events:", err);
    }
  }, []);

  // Load persisted layout once on mount.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: Layouts | null }>(
          "/layout",
        );
        if (res.success && res.data) savedLayoutRef.current = res.data;
      } catch {
        // No saved layout yet; fall back to auto layout.
      } finally {
        fetchCameras();
        fetchRecentEvents();
      }
    })();
  }, [fetchCameras, fetchRecentEvents]);

  // Reconcile layout whenever the camera set changes.
  useEffect(() => {
    if (loading || cameras.length === 0) return;
    setLayouts((prev) => mergeLayouts(prev ?? savedLayoutRef.current, cameras));
  }, [cameras, loading]);

  const persistLayout = useCallback((next: Layouts) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api
        .put("/layout", { layout: next })
        .catch((err) => console.error("Failed to save layout:", err));
    }, 800);
  }, []);

  const handleLayoutChange = useCallback(
    (_current: Layout[], all: Layouts) => {
      setLayouts(all);
      savedLayoutRef.current = all;
      liveCache.setLayouts(all);
      persistLayout(all);
    },
    [persistLayout],
  );

  // When uniform mode is on, force every tile to the default footprint.
  const displayLayouts = useMemo<Layouts | null>(() => {
    if (!layouts) return null;
    if (!uniform) return layouts;
    const out = {} as Layouts;
    (Object.keys(COLS) as BP[]).forEach((bp) => {
      const w = DEFAULT_W[bp];
      const cols = COLS[bp];
      const perRow = Math.max(1, Math.floor(cols / w));
      out[bp] = (layouts[bp] ?? []).map((it, idx) => ({
        ...it,
        x: (idx % perRow) * w,
        y: Math.floor(idx / perRow) * DEFAULT_H,
        w,
        h: DEFAULT_H,
      }));
    });
    return out;
  }, [layouts, uniform]);

  const resetLayout = useCallback(() => {
    const fresh = mergeLayouts(null, cameras);
    setLayouts(fresh);
    savedLayoutRef.current = fresh;
    persistLayout(fresh);
  }, [cameras, persistLayout]);

  const handleNewEvent = useCallback((event: Event) => {
    setEventLog((prev) => [event, ...prev.slice(0, 49)]);
    setActiveEvents((prev) => ({ ...prev, [event.cameraId]: event }));
  }, []);

  const handleCameraStatus = useCallback(
    (payload: { id: string; status: CameraStatus; lastHeartbeat?: string }) => {
      setCameras((prev) =>
        prev.map((c) =>
          c.id === payload.id
            ? {
                ...c,
                status: payload.status,
                lastHeartbeat: payload.lastHeartbeat ?? c.lastHeartbeat,
              }
            : c,
        ),
      );
    },
    [],
  );

  useSocket(undefined, handleNewEvent, handleCameraStatus);

  const clearCameraEvent = (cameraId: string) => {
    setActiveEvents((prev) => {
      const copy = { ...prev };
      delete copy[cameraId];
      return copy;
    });
  };

  const clearAllAlerts = () => setActiveEvents({});

  // Run capture or record over a chosen set of cameras, locally or on the server.
  const runCapture = useCallback(
    async (
      ids: string[],
      action: "snapshot" | "record",
      saveMode: "local" | "server",
      seconds: number,
    ) => {
      const results: string[] = [];
      for (const id of ids) {
        const cam = cameras.find((c) => c.id === id);
        if (!cam) continue;
        const name = streamNameOf(cam.rtspUrl) ?? streamNameOf(cam.subRtspUrl);
        try {
          if (saveMode === "local") {
            const el = videoEls.current[id];
            if (!el) continue;
            if (action === "snapshot") captureFrameLocal(el, cam.name);
            else recordLocal(el, cam.name, seconds * 1000);
          } else if (name) {
            const url =
              action === "snapshot"
                ? await captureFrameServer(name)
                : await recordServer(name, seconds);
            results.push(url);
          }
        } catch (err) {
          console.error(`Capture failed for ${cam.name}:`, err);
        }
      }
      if (saveMode === "server" && action === "record") {
        // Server record blocks until ffmpeg finishes; give feedback.
        alert(`Đã lưu ${results.length} bản ghi vào server (evidence/).`);
      }
    },
    [cameras],
  );

  const onlineCount = useMemo(
    () => cameras.filter((c) => c.status === "ONLINE").length,
    [cameras],
  );
  const activeAlertCount = Object.keys(activeEvents).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b border-neutral-500" />
          <p className="text-neutral-500 text-sm">Loading camera wall...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-3">
        <AlertTriangle className="w-8 h-8 text-neutral-500" />
        <p className="text-neutral-400 text-sm">{error}</p>
        <button
          onClick={fetchCameras}
          className="px-4 py-2 border border-neutral-800 text-neutral-200 rounded-md text-xs hover:bg-neutral-900 transition"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-112px)] flex flex-col xl:flex-row gap-4 overflow-hidden">
      {/* Camera wall */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-base font-medium text-neutral-100 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-neutral-400" />
              Camera Wall
            </h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              {cameras.length} cameras · {onlineCount} online ·{" "}
              {activeAlertCount} alerts
            </p>
          </div>

          <div className="flex items-center gap-2">
            {activeAlertCount > 0 && (
              <button
                onClick={clearAllAlerts}
                className="px-3 py-1.5 border border-neutral-800 text-neutral-300 text-xs rounded-md hover:bg-neutral-900 transition"
              >
                Clear alerts ({activeAlertCount})
              </button>
            )}
            <button
              onClick={() => setCaptureOpen(true)}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
              title="Record / Capture"
            >
              <Video className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={toggleUniform}
              className={`p-1.5 border rounded-md transition ${
                uniform
                  ? "border-blue-700 text-blue-400 bg-blue-950/40"
                  : "border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
              }`}
              title={uniform ? "Kích thước đồng bộ (bật)" : "Kích thước đồng bộ (tắt)"}
            >
              <Grid2x2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={resetLayout}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
              title="Reset layout"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={toggleFeed}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
              title={showFeed ? "Hide detection feed" : "Show detection feed"}
            >
              {showFeed ? (
                <PanelRightClose className="w-3.5 h-3.5" />
              ) : (
                <PanelRightOpen className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={fetchCameras}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
              title="Refresh feeds"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto pr-1">
          {cameras.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center border border-dashed border-neutral-800 rounded-lg">
              <Monitor className="w-7 h-7 text-neutral-700 mb-2" />
              <p className="text-neutral-400 text-sm">No cameras registered</p>
              <p className="text-neutral-600 text-xs mt-1">
                Register cameras under Camera Management
              </p>
            </div>
          ) : (
            displayLayouts && (
              <ResponsiveGridLayout
                className="layout"
                layouts={displayLayouts}
                breakpoints={BREAKPOINTS}
                cols={COLS}
                rowHeight={70}
                margin={[12, 12]}
                containerPadding={[0, 0]}
                draggableHandle=".cam-drag-handle"
                onLayoutChange={handleLayoutChange}
                compactType="vertical"
                preventCollision={false}
                isResizable={!uniform}
                isBounded
              >
                {cameras.map((camera) => (
                  <div
                    key={camera.id}
                    className="flex flex-col overflow-hidden"
                  >
                    <div className="cam-drag-handle flex items-center gap-1.5 px-2 py-1 bg-neutral-900 border border-neutral-800 border-b-0 rounded-t-lg cursor-move select-none">
                      <GripVertical className="w-3 h-3 text-neutral-600" />
                      <span className="text-[11px] text-neutral-400 truncate">
                        {camera.name}
                      </span>
                    </div>
                    <div className="flex-1 min-h-0">
                      <CameraFeed
                        camera={camera}
                        activeEvent={activeEvents[camera.id]}
                        onClearEvent={() => clearCameraEvent(camera.id)}
                        onVideoRef={registerVideo}
                      />
                    </div>
                  </div>
                ))}
              </ResponsiveGridLayout>
            )
          )}
        </div>
      </div>

      {/* AI detection feed */}
      {showFeed && (
        <div className="w-full xl:w-72 border border-neutral-800 rounded-lg flex flex-col shrink-0 overflow-hidden h-[280px] xl:h-auto">
          <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-200">
              Detection feed
            </h2>
            <span className="text-[10px] text-neutral-500">live</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {eventLog.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <p className="text-neutral-500 text-xs">
                  Waiting for events...
                </p>
              </div>
            ) : (
              eventLog.map((event) => (
                <div
                  key={event.id}
                  className={`p-2.5 rounded-md border text-xs flex flex-col gap-1.5 cursor-pointer transition hover:bg-neutral-900 ${
                    event.isAlert ? "border-red-900/60" : "border-neutral-800"
                  }`}
                  onClick={() => {
                    if (
                      cameras.some(
                        (c) => c.id === event.cameraId && c.status === "ONLINE",
                      )
                    ) {
                      setActiveEvents((prev) => ({
                        ...prev,
                        [event.cameraId]: event,
                      }));
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-200 truncate max-w-[130px]">
                      {event.camera?.name || "Unknown camera"}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      {formatDate(event.timestamp).split(" ")[1]}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-neutral-400">
                    <span className="text-[10px] uppercase tracking-wide">
                      {event.eventType}
                    </span>
                    <span className="text-[10px] font-medium text-neutral-300">
                      {(event.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {captureOpen && (
        <CaptureDialog
          cameras={cameras}
          onClose={() => setCaptureOpen(false)}
          onRun={runCapture}
        />
      )}
    </div>
  );
}

interface CaptureDialogProps {
  cameras: Camera[];
  onClose: () => void;
  onRun: (
    ids: string[],
    action: "snapshot" | "record",
    saveMode: "local" | "server",
    seconds: number,
  ) => Promise<void>;
}

function CaptureDialog({ cameras, onClose, onRun }: CaptureDialogProps) {
  const online = cameras.filter((c) => c.status === "ONLINE");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"snapshot" | "record">("snapshot");
  const [saveMode, setSaveMode] = useState<"local" | "server">("local");
  const [seconds, setSeconds] = useState(10);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    await onRun(Array.from(selected), action, saveMode, seconds);
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Video className="w-4 h-4" /> Record / Capture
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-sm">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Action */}
          <div className="flex gap-2">
            <button
              onClick={() => setAction("snapshot")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm border ${action === "snapshot" ? "border-blue-600 bg-blue-950/40 text-blue-300" : "border-neutral-700 text-neutral-400"}`}
            >
              <CameraIcon className="w-4 h-4" /> Ảnh
            </button>
            <button
              onClick={() => setAction("record")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm border ${action === "record" ? "border-blue-600 bg-blue-950/40 text-blue-300" : "border-neutral-700 text-neutral-400"}`}
            >
              <Video className="w-4 h-4" /> Video
            </button>
          </div>

          {action === "record" && (
            <div className="flex items-center gap-2 text-sm text-neutral-300">
              <span>Thời lượng</span>
              <input
                type="number"
                min={1}
                max={300}
                value={seconds}
                onChange={(e) => setSeconds(Math.min(300, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-20 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white"
              />
              <span>giây</span>
            </div>
          )}

          {/* Save mode */}
          <div className="flex gap-2">
            <button
              onClick={() => setSaveMode("local")}
              className={`flex-1 py-2 rounded-lg text-sm border ${saveMode === "local" ? "border-blue-600 bg-blue-950/40 text-blue-300" : "border-neutral-700 text-neutral-400"}`}
            >
              Lưu về máy
            </button>
            <button
              onClick={() => setSaveMode("server")}
              className={`flex-1 py-2 rounded-lg text-sm border ${saveMode === "server" ? "border-blue-600 bg-blue-950/40 text-blue-300" : "border-neutral-700 text-neutral-400"}`}
            >
              Lưu server
            </button>
          </div>

          {/* Camera list */}
          <div className="border border-neutral-800 rounded-lg max-h-52 overflow-y-auto divide-y divide-neutral-800">
            {online.length === 0 ? (
              <p className="text-neutral-500 text-sm p-3 text-center">Không có camera online</p>
            ) : (
              online.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-neutral-800/40">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-blue-600" />
                  <span className="text-sm text-neutral-200 truncate">{c.name}</span>
                  <span className="text-[11px] text-neutral-500 ml-auto truncate">{c.location}</span>
                </label>
              ))
            )}
          </div>
          <button
            onClick={() => setSelected(new Set(online.map((c) => c.id)))}
            className="text-[11px] text-blue-400 hover:underline"
          >
            Chọn tất cả
          </button>

          <button
            onClick={run}
            disabled={busy || selected.size === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            {busy ? "Đang xử lý..." : `Thực hiện (${selected.size} camera)`}
          </button>
        </div>
      </div>
    </div>
  );
}
