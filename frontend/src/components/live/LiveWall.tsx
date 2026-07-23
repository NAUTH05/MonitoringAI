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
  Check,
  Cpu,
  Grid2x2,
  GripVertical,
  Monitor,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Save,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layout, Layouts, Responsive, WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { useTranslation } from "react-i18next";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

// Breakpoint column counts and the default footprint a fresh camera takes.
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;
const DEFAULT_W = { lg: 4, md: 5, sm: 3, xs: 4, xxs: 2 } as const;
const DEFAULT_H = { lg: 5, md: 5, sm: 4, xs: 4, xxs: 4 } as const;
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
type BP = keyof typeof COLS;

// Build a fresh, perfectly aligned grid layout for a breakpoint, flowing cameras left-to-right.
function buildDefault(bp: BP, cameras: Camera[]): Layout[] {
  const cols = COLS[bp];
  const N = cameras.length;
  let perRow: number;
  let w: number;
  let h: number;

  if (bp === "lg") {
    if (N <= 4) {
      perRow = 2; w = 6; h = 6;
    } else if (N <= 9) {
      perRow = 3; w = 4; h = 5;
    } else {
      perRow = 4; w = 3; h = 4;
    }
  } else if (bp === "md") {
    if (N <= 4) {
      perRow = 2; w = 5; h = 5;
    } else {
      perRow = 2; w = 5; h = 4;
    }
  } else if (bp === "sm") {
    perRow = 2; w = 3; h = 4;
  } else if (bp === "xs") {
    perRow = 1; w = 4; h = 4;
  } else {
    perRow = 1; w = 2; h = 4;
  }

  return cameras.map((cam, idx) => ({
    i: cam.id,
    x: (idx % perRow) * w,
    y: Math.floor(idx / perRow) * h,
    w,
    h,
    minW: 3,
    minH: 4,
    maxW: 12,
    maxH: 12,
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
      if (existing) kept.push({ ...existing, i: cam.id, minW: 3, minH: 3, maxW: 12, maxH: 12 });
    });

    // Append any new cameras below the current arrangement.
    const missing = cameras.filter((cam) => !byId.has(cam.id));
    if (missing.length) {
      const maxY = kept.reduce((m, it) => Math.max(m, it.y + it.h), 0);
      const cols = COLS[bp];
      const w = DEFAULT_W[bp];
      const h = DEFAULT_H[bp];
      const perRow = Math.max(1, Math.floor(cols / w));
      missing.forEach((cam, idx) => {
        kept.push({
          i: cam.id,
          x: (idx % perRow) * w,
          y: maxY + Math.floor(idx / perRow) * h,
          w,
          h,
          minW: 3,
          minH: 3,
          maxW: 12,
          maxH: 12,
        });
      });
    }
    result[bp] = kept.length ? kept : buildDefault(bp, cameras);
  });
  return result;
}

// Force every tile in every breakpoint to a common w/h. The common size is
// taken from overrideSize (if provided), or the first tile of the current breakpoint,
// falling back to the breakpoint default. Positions are left untouched.
function normalizeUniform(
  base: Layouts | null,
  currentBp: BP,
  overrideSize?: { w: number; h: number } | null,
): Layouts | null {
  if (!base) return base;
  const cur = base[currentBp] ?? [];
  const w = overrideSize?.w ?? cur[0]?.w ?? DEFAULT_W[currentBp];
  const h = overrideSize?.h ?? cur[0]?.h ?? DEFAULT_H[currentBp];
  const next = {} as Layouts;
  (Object.keys(COLS) as BP[]).forEach((bp) => {
    next[bp] = (base[bp] ?? []).map((it) => ({ ...it, w, h }));
  });
  return next;
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

export function LiveWall() {
  const { t } = useTranslation();

  // Seed from module cache so returning to /live paints instantly (no cold-start).
  const [cameras, setCameras] = useState<Camera[]>(() => liveCache.getCameras() ?? []);
  const [loading, setLoading] = useState(() => liveCache.getCameras() === null);
  const [error, setError] = useState("");

  const [layouts, setLayouts] = useState<Layouts | null>(() => liveCache.getLayouts());
  const savedLayoutRef = useRef<Layouts | null>(liveCache.getLayouts());
  const userSavedLayoutRef = useRef<Layouts | null>(null);
  const lastResizedSizeRef = useRef<{ w: number; h: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountingRef = useRef(true);
  const isInteractingRef = useRef(false);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2800);
  }, []);

  const [activeEvents, setActiveEvents] = useState<Record<string, Event>>({});
  const [eventLog, setEventLog] = useState<Event[]>([]);
  const [showFeed, setShowFeed] = useState(true);
  const [uniform, setUniform] = useState(false);
  const [gridGap, setGridGap] = useState<number>(2);
  const [currentBp, setCurrentBp] = useState<BP>("lg");
  const [captureOpen, setCaptureOpen] = useState(false);

  // Live <video> elements by camera id, for capture/record.
  const videoEls = useRef<Record<string, HTMLVideoElement | null>>({});
  const registerVideo = useCallback((id: string, el: HTMLVideoElement | null) => {
    videoEls.current[id] = el;
  }, []);

  const [streamResolutions, setStreamResolutions] = useState<
    Record<string, { width: number; height: number; aspectRatio: number }>
  >({});

  const handleResolution = useCallback(
    (camId: string, res: { width: number; height: number; aspectRatio: number }) => {
      setStreamResolutions((prev) => {
        const existing = prev[camId];
        if (existing && existing.width === res.width && existing.height === res.height) {
          return prev;
        }
        const nextResolutions = { ...prev, [camId]: res };

        // Automatically bind tile height & min size based on native stream resolution & aspect ratio!
        setLayouts((curLayouts) => {
          if (!curLayouts) return curLayouts;
          const next = {} as Layouts;
          (Object.keys(COLS) as BP[]).forEach((bp) => {
            const items = curLayouts[bp] ?? [];
            next[bp] = items.map((item) => {
              if (item.i !== camId) return item;

              const ratio = res.aspectRatio;
              let targetH = item.h;
              let minW = 3;
              let minH = 3;

              if (ratio >= 1.5) {
                // 16:9 widescreen HD (e.g. 1920x1080, 1280x720)
                // Account for top header bar (35px) + video aspect ratio
                targetH = Math.max(4, Math.round(item.w * 1.15));
                minW = 3;
                minH = 4;
              } else if (ratio >= 1.1) {
                // 4:3 standard (e.g. 1280x960, 640x480)
                targetH = Math.max(4, Math.round(item.w * 1.35));
                minW = 3;
                minH = 5;
              } else {
                // Vertical / Corridor 9:16 (e.g. 1080x1920)
                targetH = Math.max(6, Math.round(item.w * 2.2));
                minW = 2;
                minH = 6;
              }

              return {
                ...item,
                h: targetH,
                minW,
                minH,
              };
            });
          });
          savedLayoutRef.current = next;
          liveCache.setLayouts(next);
          return next;
        });

        return nextResolutions;
      });
    },
    [],
  );

  const persistLayout = useCallback((next: Layouts) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api
        .put("/layout", { layout: next })
        .catch((err) => console.error("Failed to save layout:", err));
    }, 800);
  }, []);

  // Restore preferences & mounting guard to prevent layout corruption during tab switch.
  useEffect(() => {
    isMountingRef.current = true;
    const timer = setTimeout(() => {
      isMountingRef.current = false;
    }, 1000);

    setShowFeed(localStorage.getItem("liveShowFeed") !== "0");
    setUniform(localStorage.getItem("liveUniform") === "1");
    const savedGap = localStorage.getItem("liveGridGap");
    if (savedGap) setGridGap(Number(savedGap));
    else setGridGap(2);

    return () => clearTimeout(timer);
  }, []);

  const changeGridGap = useCallback((gap: number) => {
    setGridGap(gap);
    localStorage.setItem("liveGridGap", String(gap));
  }, []);

  const toggleFeed = useCallback(() => {
    setShowFeed((prev) => {
      const next = !prev;
      localStorage.setItem("liveShowFeed", next ? "1" : "0");
      return next;
    });
  }, []);

  // Turning uniform on immediately normalizes every tile to one common size.
  const toggleUniform = useCallback(() => {
    setUniform((prev) => {
      const next = !prev;
      localStorage.setItem("liveUniform", next ? "1" : "0");
      if (next) {
        setLayouts((cur) => {
          const norm = normalizeUniform(cur ?? savedLayoutRef.current, currentBp, lastResizedSizeRef.current);
          if (norm) {
            savedLayoutRef.current = norm;
            liveCache.setLayouts(norm);
          }
          return norm ?? cur;
        });
      } else {
        lastResizedSizeRef.current = null;
      }
      return next;
    });
  }, [currentBp]);

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
      setError(err instanceof Error ? err.message : t("live.loadCamerasFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
        if (res.success && res.data) {
          savedLayoutRef.current = res.data;
          userSavedLayoutRef.current = res.data;
        }
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
    setLayouts((prev) => {
      const merged = mergeLayouts(prev ?? savedLayoutRef.current, cameras);
      return uniform ? normalizeUniform(merged, currentBp, lastResizedSizeRef.current) ?? merged : merged;
    });
  }, [cameras, loading, uniform, currentBp]);

  const handleDragStart = useCallback(() => {
    isInteractingRef.current = true;
  }, []);

  const handleDragStop = useCallback(() => {
    setTimeout(() => {
      isInteractingRef.current = false;
    }, 100);
  }, []);

  const handleResizeStart = useCallback(() => {
    isInteractingRef.current = true;
  }, []);

  const handleLayoutChange = useCallback(
    (_current: Layout[], all: Layouts) => {
      // 🚨 Guard against tab switching / un-hiding / container resize events!
      // ONLY update layouts state if the user is actively dragging or resizing tiles.
      if (!isInteractingRef.current) return;

      const next = uniform ? normalizeUniform(all, currentBp, lastResizedSizeRef.current) ?? all : all;
      setLayouts(next);
      savedLayoutRef.current = next;
      liveCache.setLayouts(next);
    },
    [uniform, currentBp],
  );

  // When uniform mode is on, resizing ANY tile applies its new size (w, h) to EVERY
  // tile in the current breakpoint while leaving each tile's position intact.
  const handleResizeStop = useCallback(
    (current: Layout[], _old: Layout, updated: Layout) => {
      isInteractingRef.current = true;
      if (uniform) {
        // Record whichever camera tile was resized (Camera 1, 2, 3, 4...) as the benchmark size
        lastResizedSizeRef.current = { w: updated.w, h: updated.h };

        setLayouts((prev) => {
          const base = prev ?? savedLayoutRef.current;
          if (!base) return prev;
          const next = {} as Layouts;
          (Object.keys(COLS) as BP[]).forEach((bp) => {
            const items = bp === currentBp ? current : base[bp] ?? [];
            next[bp] = items.map((it) => ({ ...it, w: updated.w, h: updated.h }));
          });
          savedLayoutRef.current = next;
          liveCache.setLayouts(next);
          return next;
        });
      }
      setTimeout(() => {
        isInteractingRef.current = false;
      }, 100);
    },
    [uniform, currentBp],
  );

  // EXPLICIT Save custom layout ONLY when user clicks Save button!
  const saveCustomLayout = useCallback(() => {
    if (!layouts) return;
    const snapshot = JSON.parse(JSON.stringify(layouts));
    userSavedLayoutRef.current = snapshot;
    try {
      localStorage.setItem("user_saved_layout", JSON.stringify(snapshot));
    } catch {
      /* ignore */
    }
    persistLayout(snapshot);
    showNotification("✓ Đã lưu vị trí & kích thước bố cục thành công!");
  }, [layouts, persistLayout, showNotification]);

  // Restore BOTH exact positions AND sizes from the saved snapshot
  const restoreSavedLayout = useCallback(() => {
    let saved = userSavedLayoutRef.current;
    if (!saved) {
      try {
        const str = localStorage.getItem("user_saved_layout");
        if (str) saved = JSON.parse(str);
      } catch {
        /* ignore */
      }
    }

    if (saved) {
      const snapshot = JSON.parse(JSON.stringify(saved));
      lastResizedSizeRef.current = null; // Clear transient resize override!
      setLayouts(snapshot);
      savedLayoutRef.current = snapshot;
      liveCache.setLayouts(snapshot);
      showNotification("↺ Đã khôi phục đầy đủ vị trí & kích thước đã lưu!");
    } else if (cameras.length > 0) {
      const fresh = {} as Layouts;
      (Object.keys(COLS) as BP[]).forEach((bp) => {
        fresh[bp] = buildDefault(bp, cameras);
      });
      lastResizedSizeRef.current = null;
      setLayouts(fresh);
      savedLayoutRef.current = fresh;
      liveCache.setLayouts(fresh);
      showNotification("↺ Đã đặt lại bố cục mặc định!");
    }
  }, [cameras, showNotification]);

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
        alert(t("live.serverRecordSaved", { count: results.length }));
      }
    },
    [cameras, t],
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
          <p className="text-neutral-500 text-sm">{t("live.loadingWall")}</p>
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
          {t("common.tryAgain")}
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
              {t("live.cameraWall")}
            </h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              {t("live.summary", {
                cameras: cameras.length,
                online: onlineCount,
                alerts: activeAlertCount,
              })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {activeAlertCount > 0 && (
              <button
                onClick={clearAllAlerts}
                className="px-3 py-1.5 border border-neutral-800 text-neutral-300 text-xs rounded-md hover:bg-neutral-900 transition"
              >
                {t("live.clearAlerts", { count: activeAlertCount })}
              </button>
            )}

            {/* Save layout & Restore saved layout */}
            <button
              onClick={saveCustomLayout}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-emerald-400 hover:bg-neutral-900 transition flex items-center gap-1"
              title="Lưu vị trí & kích thước bố cục hiện tại"
            >
              <Save className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={restoreSavedLayout}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition flex items-center gap-1"
              title="Khôi phục về bố cục đã lưu gần nhất"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Uniform size toggle */}
            <button
              onClick={toggleUniform}
              className={`p-1.5 border rounded-md transition ${
                uniform
                  ? "border-blue-700 text-blue-400 bg-blue-950/40"
                  : "border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
              }`}
              title={uniform ? t("live.uniformOn") : t("live.uniformOff")}
            >
              <Grid2x2 className="w-3.5 h-3.5" />
            </button>

            {/* Capture/Record */}
            <button
              onClick={() => setCaptureOpen(true)}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
              title={t("live.recordCapture")}
            >
              <Video className="w-3.5 h-3.5" />
            </button>

            {/* Toggle right feed */}
            <button
              onClick={toggleFeed}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
              title={showFeed ? t("live.hideFeed") : t("live.showFeed")}
            >
              {showFeed ? (
                <PanelRightClose className="w-3.5 h-3.5" />
              ) : (
                <PanelRightOpen className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Refresh feeds */}
            <button
              onClick={fetchCameras}
              className="p-1.5 border border-neutral-800 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition"
              title={t("live.refreshFeeds")}
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
              <p className="text-neutral-400 text-sm">{t("live.noCameras")}</p>
              <p className="text-neutral-600 text-xs mt-1">
                {t("live.noCamerasHint")}
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
                margin={[gridGap, gridGap]}
                containerPadding={[0, 0]}
                draggableHandle=".cam-drag-handle"
                onDragStart={handleDragStart}
                onDragStop={handleDragStop}
                onResizeStart={handleResizeStart}
                onResizeStop={handleResizeStop}
                onLayoutChange={handleLayoutChange}
                onBreakpointChange={(bp) => setCurrentBp(bp as BP)}
                compactType="vertical"
                preventCollision={false}
                isResizable
                isBounded
              >
                {cameras.map((camera) => (
                  <div
                    key={camera.id}
                    className="flex flex-col overflow-hidden"
                  >
                    <div className="cam-drag-handle flex items-center justify-between px-2.5 py-1.5 bg-neutral-950 border border-neutral-800 rounded-t-lg cursor-move select-none shrink-0 border-b-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                        <span className="text-xs font-semibold text-neutral-200 truncate">{camera.name}</span>
                        {camera.location && (
                          <span className="text-[10px] text-neutral-500 truncate hidden sm:inline">
                            ({camera.location})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {streamResolutions[camera.id] && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400">
                            {streamResolutions[camera.id].height >= 1080
                              ? `${streamResolutions[camera.id].height}p HD`
                              : `${streamResolutions[camera.id].width}x${streamResolutions[camera.id].height}`}
                          </span>
                        )}
                        {camera.status === "ONLINE" ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Online
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-neutral-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                            {camera.status}
                          </span>
                        )}
                        {camera.cameraModules && camera.cameraModules.length > 0 && (
                          <div className="flex items-center gap-0.5 text-neutral-400" title={`${camera.cameraModules.length} AI Module`}>
                            <Cpu className="w-3 h-3 text-blue-400" />
                            <span className="text-[10px] font-mono">{camera.cameraModules.length}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0">
                      <CameraFeed
                        camera={camera}
                        activeEvent={activeEvents[camera.id]}
                        onClearEvent={() => clearCameraEvent(camera.id)}
                        onVideoRef={registerVideo}
                        onResolution={(res) => handleResolution(camera.id, res)}
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
              {t("live.detectionFeed")}
            </h2>
            <span className="text-[10px] text-neutral-500">{t("live.liveTag")}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {eventLog.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <p className="text-neutral-500 text-xs">
                  {t("live.waitingEvents")}
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
                      {event.camera?.name || t("live.unknownCamera")}
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

      {/* Floating notification toast */}
      {toastMsg && (
        <div className="fixed top-16 right-6 z-50 px-4 py-2.5 bg-neutral-900/95 border border-neutral-700 text-neutral-100 text-xs rounded-lg shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{toastMsg}</span>
        </div>
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
  const { t } = useTranslation();
  const online = cameras.filter((c) => c.status === "ONLINE");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<"snapshot" | "record">("snapshot");
  const [saveMode, setSaveMode] = useState<"local" | "server">("local");
  const [seconds, setSeconds] = useState(10);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Video className="w-4 h-4" /> {t("live.recordCapture")}
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
              <CameraIcon className="w-4 h-4" /> {t("live.photo")}
            </button>
            <button
              onClick={() => setAction("record")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm border ${action === "record" ? "border-blue-600 bg-blue-950/40 text-blue-300" : "border-neutral-700 text-neutral-400"}`}
            >
              <Video className="w-4 h-4" /> {t("live.video")}
            </button>
          </div>

          {action === "record" && (
            <div className="flex items-center gap-2 text-sm text-neutral-300">
              <span>{t("live.duration")}</span>
              <input
                type="number"
                min={1}
                max={300}
                value={seconds}
                onChange={(e) => setSeconds(Math.min(300, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-20 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white"
              />
              <span>{t("live.seconds")}</span>
            </div>
          )}

          {/* Save mode */}
          <div className="flex gap-2">
            <button
              onClick={() => setSaveMode("local")}
              className={`flex-1 py-2 rounded-lg text-sm border ${saveMode === "local" ? "border-blue-600 bg-blue-950/40 text-blue-300" : "border-neutral-700 text-neutral-400"}`}
            >
              {t("live.saveLocal")}
            </button>
            <button
              onClick={() => setSaveMode("server")}
              className={`flex-1 py-2 rounded-lg text-sm border ${saveMode === "server" ? "border-blue-600 bg-blue-950/40 text-blue-300" : "border-neutral-700 text-neutral-400"}`}
            >
              {t("live.saveServer")}
            </button>
          </div>

          {/* Camera list */}
          <div className="border border-neutral-800 rounded-lg max-h-52 overflow-y-auto divide-y divide-neutral-800">
            {online.length === 0 ? (
              <p className="text-neutral-500 text-sm p-3 text-center">{t("live.noOnlineCamera")}</p>
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
            {t("live.selectAll")}
          </button>

          <button
            onClick={run}
            disabled={busy || selected.size === 0}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition text-sm"
          >
            {busy ? t("live.processing") : t("live.runCapture", { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
