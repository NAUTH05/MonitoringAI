"use client";

import { CameraFeed } from "@/components/cameras/CameraFeed";
import { useSocket } from "@/hooks/useSocket";
import { api } from "@/lib/api";
import { Camera, CameraStatus, Event } from "@/types";
import {
  Activity,
  AlertTriangle,
  Cpu,
  LayoutGrid,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getEventTypeColor, formatDate } from "@/lib/utils";

export default function LiveViewPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // UI Configuration Settings
  const [gridCols, setGridCols] = useState<1 | 2 | 3>(2);
  const [showScanlines, setShowScanlines] = useState(true);

  // Real-time Event States
  const [activeEvents, setActiveEvents] = useState<Record<string, Event>>({});
  const [eventLog, setEventLog] = useState<Event[]>([]);

  // Fetch registered cameras
  const fetchCameras = async () => {
    try {
      // Get all active cameras
      const res = await api.get<{ success: boolean; data: Camera[] }>("/cameras?limit=100");
      if (res.success) {
        // Only display ONLINE/OFFLINE active cameras
        setCameras(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cameras");
    } finally {
      setLoading(false);
    }
  };

  // Fetch recent event history to pre-populate logs
  const fetchRecentEvents = async () => {
    try {
      const res = await api.get<{ success: boolean; data: Event[] }>("/events?limit=25");
      if (res.success) {
        setEventLog(res.data);
      }
    } catch (err) {
      console.error("Failed to load historical events:", err);
    }
  };

  useEffect(() => {
    fetchCameras();
    fetchRecentEvents();
  }, []);

  // Listen to new events via Socket.IO
  const handleNewEvent = useCallback((event: Event) => {
    // 1. Add event to top of right audit log
    setEventLog((prev) => [event, ...prev.slice(0, 49)]);

    // 2. Set active alert highlight for this specific camera
    setActiveEvents((prev) => ({
      ...prev,
      [event.cameraId]: event,
    }));
  }, []);

  // Update camera status in the grid in realtime (heartbeat / watchdog)
  const handleCameraStatus = useCallback(
    (payload: { id: string; status: CameraStatus; lastHeartbeat?: string }) => {
      setCameras((prev) =>
        prev.map((c) =>
          c.id === payload.id
            ? { ...c, status: payload.status, lastHeartbeat: payload.lastHeartbeat ?? c.lastHeartbeat }
            : c
        )
      );
    },
    []
  );

  useSocket(undefined, handleNewEvent, handleCameraStatus);

  // Clear specific camera event state
  const clearCameraEvent = (cameraId: string) => {
    setActiveEvents((prev) => {
      const copy = { ...prev };
      delete copy[cameraId];
      return copy;
    });
  };

  // Clear all camera alert highlights manually
  const clearAllAlerts = () => {
    setActiveEvents({});
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[70vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <p className="text-gray-400 text-sm">Connecting live streams...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-3">
        <AlertTriangle className="w-10 h-10 text-red-500" />
        <p className="text-red-400 text-sm font-medium">{error}</p>
        <button
          onClick={fetchCameras}
          className="px-4 py-2 bg-gray-800 border border-gray-700 text-white rounded-lg text-xs hover:bg-gray-700 transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  const activeAlertCount = Object.keys(activeEvents).length;
  const onlineCount = cameras.filter((c) => c.status === "ONLINE").length;

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col xl:flex-row gap-5 overflow-hidden">
      {/* LEFT CONTENT: Camera Matrix Viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* HUD Toolbar Header */}
        <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Monitor className="w-5 h-5 text-blue-500" />
              Live Camera Observation
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Observing {cameras.length} cameras | {onlineCount} online | {activeAlertCount} active alarms
            </p>
          </div>

          {/* Settings & Layout Controls */}
          <div className="flex flex-wrap items-center gap-3">

            {/* Clear Alerts button */}
            {activeAlertCount > 0 && (
              <button
                onClick={clearAllAlerts}
                className="px-3 py-1.5 bg-red-950 hover:bg-red-900 border border-red-800 text-red-200 text-xs rounded-lg transition"
              >
                Clear Alarms ({activeAlertCount})
              </button>
            )}

            {/* Grid selector */}
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
              <button
                onClick={() => setGridCols(1)}
                className={`p-1 rounded text-xs transition ${
                  gridCols === 1 ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                }`}
                title="Single Screen"
              >
                1x1
              </button>
              <button
                onClick={() => setGridCols(2)}
                className={`p-1 rounded text-xs transition ${
                  gridCols === 2 ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                }`}
                title="Quad Layout"
              >
                2x2
              </button>
              <button
                onClick={() => setGridCols(3)}
                className={`p-1 rounded text-xs transition ${
                  gridCols === 3 ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                }`}
                title="Matrix Layout"
              >
                3x3
              </button>
            </div>

            {/* Config toggles */}
            <div className="flex items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-gray-400 hover:text-white select-none">
                <input
                  type="checkbox"
                  checked={showScanlines}
                  onChange={(e) => setShowScanlines(e.target.checked)}
                  className="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                />
                Scanlines
              </label>
            </div>

            <button
              onClick={fetchCameras}
              className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition"
              title="Refresh feeds"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Matrix Grid */}
        <div className="flex-1 overflow-y-auto pr-1">
          {cameras.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center border border-dashed border-gray-800 rounded-2xl bg-gray-900/50">
              <Monitor className="w-8 h-8 text-gray-600 mb-2" />
              <p className="text-gray-400 text-sm font-medium">No cameras registered</p>
              <p className="text-gray-500 text-xs mt-1">Please register cameras under Camera Management</p>
            </div>
          ) : (
            <div
              className={`grid gap-4 ${
                gridCols === 1
                  ? "grid-cols-1"
                  : gridCols === 2
                  ? "grid-cols-1 sm:grid-cols-2"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {cameras.map((camera) => (
                <CameraFeed
                  key={camera.id}
                  camera={camera}
                  showScanlines={showScanlines}
                  activeEvent={activeEvents[camera.id]}
                  onClearEvent={() => clearCameraEvent(camera.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR: Live AI Audit Log */}
      <div className="w-full xl:w-80 bg-gray-900 border border-gray-800 rounded-xl flex flex-col shrink-0 overflow-hidden h-[300px] xl:h-auto">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-gray-800 bg-gray-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-500 animate-pulse" />
            <h2 className="font-bold text-sm text-white">AI Detection Feed</h2>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Activity className="w-2.5 h-2.5 animate-ping" />
            SOCKET ACTIVE
          </span>
        </div>

        {/* Audit Log list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {eventLog.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4">
              <LayoutGrid className="w-6 h-6 text-gray-700 mb-2" />
              <p className="text-gray-500 text-xs">Waiting for live data...</p>
              <p className="text-gray-600 text-[10px] mt-1 max-w-[180px]">
                Events posted to /api/events will stream here instantly.
              </p>
            </div>
          ) : (
            eventLog.map((event) => (
              <div
                key={event.id}
                className={`p-2.5 rounded-lg border bg-gray-950/70 transition hover:bg-gray-950/90 text-xs flex flex-col gap-1.5 cursor-pointer ${
                  event.isAlert
                    ? "border-red-900/50 hover:border-red-800"
                    : "border-gray-800 hover:border-gray-700"
                }`}
                onClick={() => {
                  // If camera is online, highlight it by creating an active alert event state manually
                  if (cameras.some((c) => c.id === event.cameraId && c.status === "ONLINE")) {
                    setActiveEvents((prev) => ({
                      ...prev,
                      [event.cameraId]: event,
                    }));
                  } else {
                    alert(`Camera ${event.camera?.name || "Unknown"} is offline.`);
                  }
                }}
              >
                {/* Event header */}
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white truncate max-w-[130px]">
                    {event.camera?.name || "Unknown Camera"}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">
                    {formatDate(event.timestamp).split(" ")[1]} {/* Just show HH:MM */}
                  </span>
                </div>

                {/* Event details */}
                <div className="flex items-center justify-between">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getEventTypeColor(
                      event.eventType
                    )}`}
                  >
                    {event.eventType}
                  </span>
                  <span className="font-semibold text-gray-300 font-mono">
                    {(event.confidence * 100).toFixed(0)}% Conf
                  </span>
                </div>

                {/* Warning banner */}
                {event.isAlert && (
                  <span className="text-[10px] text-red-400 font-medium bg-red-950/45 px-1.5 py-0.5 rounded border border-red-900/30 text-center uppercase tracking-wide">
                    🚨 High-Risk Threat
                  </span>
                )}
              </div>
            ))
          )}
        </div>
        
        {/* Sidebar Footer */}
        <div className="p-3 border-t border-gray-800 bg-gray-950/40 text-[10px] text-gray-500 text-center">
          Click logs to pinpoint source camera feeds.
        </div>
      </div>
    </div>
  );
}
