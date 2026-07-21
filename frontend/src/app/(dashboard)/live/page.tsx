"use client";

import { CameraFeed } from "@/components/cameras/CameraFeed";
import { useSocket } from "@/hooks/useSocket";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Camera, CameraStatus, Event } from "@/types";
import {
  AlertTriangle,
  GripVertical,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
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

export default function LiveViewPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [layouts, setLayouts] = useState<Layouts | null>(null);
  const savedLayoutRef = useRef<Layouts | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeEvents, setActiveEvents] = useState<Record<string, Event>>({});
  const [eventLog, setEventLog] = useState<Event[]>([]);
  const [showFeed, setShowFeed] = useState(true);

  // Restore feed-panel preference.
  useEffect(() => {
    setShowFeed(localStorage.getItem("liveShowFeed") !== "0");
  }, []);

  const toggleFeed = useCallback(() => {
    setShowFeed((prev) => {
      const next = !prev;
      localStorage.setItem("liveShowFeed", next ? "1" : "0");
      return next;
    });
  }, []);

  const fetchCameras = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: Camera[] }>(
        "/cameras?limit=100",
      );
      if (res.success) setCameras(res.data);
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
      persistLayout(all);
    },
    [persistLayout],
  );

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
            layouts && (
              <ResponsiveGridLayout
                className="layout"
                layouts={layouts}
                breakpoints={BREAKPOINTS}
                cols={COLS}
                rowHeight={70}
                margin={[12, 12]}
                containerPadding={[0, 0]}
                draggableHandle=".cam-drag-handle"
                onLayoutChange={handleLayoutChange}
                compactType="vertical"
                preventCollision={false}
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
    </div>
  );
}
