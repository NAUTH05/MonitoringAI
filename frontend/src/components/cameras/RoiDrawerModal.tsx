"use client";

import { Go2RtcPlayer, PlayerState } from "@/components/cameras/Go2RtcPlayer";
import { api } from "@/lib/api";
import { ApiResponse, Camera, CameraModule } from "@/types";
import {
  Camera as CameraIcon,
  Check,
  Code,
  Copy,
  Eye,
  Image as ImageIcon,
  Move,
  RefreshCw,
  RotateCcw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Point {
  x: number; // Normalized 0..1
  y: number; // Normalized 0..1
}

interface RoiDrawerModalProps {
  camera: Camera;
  cameraModule: CameraModule;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function deriveStreamName(url: string | undefined | null): string | null {
  if (!url) return null;
  const u = url.trim();
  const m = u.match(/[?&]src=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (u.startsWith("rtsp://")) return null;
  if (/^[\w.-]+$/.test(u)) return u;
  return null;
}

function getGo2RtcFrameUrl(streamName: string, key: number): string {
  const env = process.env.NEXT_PUBLIC_GO2RTC_URL;
  let base: string;
  if (env) {
    base = env.replace(/\/$/, "");
  } else if (typeof window !== "undefined") {
    const proto = window.location.protocol;
    base = `${proto}//${window.location.hostname}:1984`;
  } else {
    base = "http://localhost:1984";
  }
  return `${base}/api/frame.jpeg?src=${encodeURIComponent(streamName)}&t=${key}`;
}

export function RoiDrawerModal({
  camera,
  cameraModule,
  isOpen,
  onClose,
  onSaved,
}: RoiDrawerModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [activeDragIndex, setActiveDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View mode & snapshot state
  const [viewMode, setViewMode] = useState<"live" | "snapshot">("live");
  const [playerState, setPlayerState] = useState<PlayerState>("connecting");
  const [snapshotKey, setSnapshotKey] = useState<number>(Date.now());
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState(false);

  // Coordinates Inspection & Copy state
  const [showViewAllModal, setShowViewAllModal] = useState(false);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  // Resolve proper go2rtc stream name
  const rawUrl = camera.rtspUrl || camera.subRtspUrl;
  const streamName = deriveStreamName(rawUrl) || camera.name || camera.id;

  // Initialize points from module config
  useEffect(() => {
    if (isOpen) {
      const existingRoi = cameraModule.config?.roiPolygon;
      if (Array.isArray(existingRoi) && existingRoi.length > 0) {
        setPoints(existingRoi);
      } else {
        setPoints([]);
      }
      setError(null);
      setViewMode("live");
      setSnapshotKey(Date.now());
      setShowViewAllModal(false);
      setCopiedFormat(null);
    }
  }, [isOpen, cameraModule]);

  const refreshSnapshot = () => {
    setSnapshotLoading(true);
    setSnapshotError(false);
    setSnapshotKey(Date.now());
  };

  // Convert mouse event coordinates to normalized [0, 1]
  const getNormalizedPoint = useCallback((e: React.MouseEvent<SVGSVGElement>): Point | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    return {
      x: Math.round(x * 10000) / 10000,
      y: Math.round(y * 10000) / 10000,
    };
  }, []);

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeDragIndex !== null) {
      setActiveDragIndex(null);
      return;
    }

    const newPoint = getNormalizedPoint(e);
    if (!newPoint) return;

    const threshold = 0.03;
    const existingIndex = points.findIndex(
      (p) => Math.abs(p.x - newPoint.x) < threshold && Math.abs(p.y - newPoint.y) < threshold
    );

    if (existingIndex !== -1) {
      return;
    }

    setPoints((prev) => [...prev, newPoint]);
  };

  const handleMouseDownPoint = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDragIndex(index);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeDragIndex === null) return;
    const point = getNormalizedPoint(e);
    if (!point) return;

    setPoints((prev) => {
      const copy = [...prev];
      copy[activeDragIndex] = point;
      return copy;
    });
  };

  const handleMouseUp = () => {
    if (activeDragIndex !== null) {
      setActiveDragIndex(null);
    }
  };

  const handleUndo = () => {
    setPoints((prev) => prev.slice(0, -1));
  };

  const handleReset = () => {
    setPoints([]);
  };

  const copyToClipboard = (text: string, formatName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFormat(formatName);
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  const handleSave = async () => {
    if (points.length > 0 && points.length < 3) {
      setError("Đa giác vùng cấm phải có ít nhất 3 điểm.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const currentConfig = cameraModule.config || {};
      const newConfig = {
        ...currentConfig,
        roiPolygon: points,
      };

      const res = await api.patch<ApiResponse<CameraModule>>(
        `/modules/camera/${camera.id}/${cameraModule.moduleId}/config`,
        { config: newConfig }
      );

      if (res.success) {
        onSaved();
        onClose();
      } else {
        setError(res.message || "Lỗi khi lưu cấu hình.");
      }
    } catch {
      setError("Không thể kết nối đến máy chủ.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  // Use 1000x1000 viewBox for standard SVG numeric points compliance (fixes console warning)
  const polygonPointsStr = points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ");

  const jsonFormatStr = JSON.stringify(points, null, 2);
  const pythonFormatStr = `np.array([${points.map((p) => `[${p.x}, ${p.y}]`).join(", ")}])`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <span>Vẽ Vùng Cấm (ROI)</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                {cameraModule.module.name}
              </span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Camera: <span className="text-gray-200 font-medium">{camera.name}</span> ({streamName})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {/* Controls Bar & Mode Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-950/60 border border-gray-800 rounded-lg p-2.5">
            <div className="flex items-center gap-2 text-xs text-blue-300">
              <Move className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                Click chuột lên hình để tạo góc vùng cấm. Kéo các điểm để di chuyển.
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Switch View Mode */}
              <div className="flex items-center p-0.5 bg-gray-800 border border-gray-700 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("live")}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                    viewMode === "live"
                      ? "bg-blue-600 text-white font-medium shadow"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <Video className="w-3.5 h-3.5" />
                  Stream Trực Tiếp
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMode("snapshot");
                    refreshSnapshot();
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition ${
                    viewMode === "snapshot"
                      ? "bg-blue-600 text-white font-medium shadow"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Ảnh Chụp (Snapshot)
                </button>
              </div>

              {viewMode === "snapshot" && (
                <button
                  type="button"
                  onClick={refreshSnapshot}
                  className="p-1.5 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-300 rounded-lg transition"
                  title="Chụp lại khung hình mới"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${snapshotLoading ? "animate-spin" : ""}`} />
                </button>
              )}

              <span className="font-mono bg-blue-950/80 border border-blue-800/40 text-blue-300 px-2.5 py-1 rounded-lg text-xs font-semibold">
                {points.length} điểm
              </span>
            </div>
          </div>

          {error && (
            <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Video Container + SVG Overlay */}
          <div
            ref={containerRef}
            className="relative aspect-video w-full bg-black rounded-lg overflow-hidden border border-gray-800 select-none cursor-crosshair group"
          >
            {/* View Mode: Live Stream */}
            {viewMode === "live" && (
              <>
                <Go2RtcPlayer
                  streamName={streamName}
                  active={isOpen}
                  onState={setPlayerState}
                  className="w-full h-full object-contain bg-black"
                />
                {playerState !== "playing" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs gap-2 pointer-events-none z-0">
                    <span className="inline-block animate-spin border-2 border-blue-500 border-t-transparent rounded-full w-6 h-6" />
                    <span className="text-xs font-mono text-gray-300">
                      {playerState === "error" ? "Đang kết nối lại luồng video..." : "Đang tải luồng camera..."}
                    </span>
                    <button
                      type="button"
                      onClick={() => setViewMode("snapshot")}
                      className="mt-2 pointer-events-auto px-3 py-1 bg-gray-800 border border-gray-700 hover:bg-gray-700 text-xs text-blue-400 rounded-lg transition"
                    >
                      Chuyển sang xem Ảnh chụp (Snapshot)
                    </button>
                  </div>
                )}
              </>
            )}

            {/* View Mode: Snapshot Frame */}
            {viewMode === "snapshot" && (
              <div className="relative w-full h-full bg-black flex items-center justify-center">
                {!snapshotError ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={getGo2RtcFrameUrl(streamName, snapshotKey)}
                    alt="Camera Snapshot"
                    onLoad={() => setSnapshotLoading(false)}
                    onError={() => {
                      setSnapshotLoading(false);
                      setSnapshotError(true);
                    }}
                    className="w-full h-full object-contain pointer-events-none"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-gray-400 p-4 text-center">
                    <CameraIcon className="w-8 h-8 text-gray-600" />
                    <span className="text-xs">Không thể tải khung hình snapshot từ camera.</span>
                    <button
                      type="button"
                      onClick={refreshSnapshot}
                      className="px-3 py-1 bg-gray-800 border border-gray-700 text-xs text-white rounded-lg transition hover:bg-gray-700"
                    >
                      Thử lại
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* SVG Drawing Layer with standard numeric viewBox 0 0 1000 1000 */}
            <svg
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full z-10 touch-none"
              onClick={handleSvgClick}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              {/* Closed Polygon Fill */}
              {points.length >= 3 && (
                <polygon
                  points={polygonPointsStr}
                  fill="rgba(239, 68, 68, 0.25)"
                  stroke="#ef4444"
                  strokeWidth="3"
                  strokeDasharray="6 6"
                />
              )}

              {/* Polylines for < 3 points */}
              {points.length > 1 && points.length < 3 && (
                <polyline
                  points={polygonPointsStr}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="3"
                  strokeDasharray="6 6"
                />
              )}

              {/* Point Circles & Drag Handles */}
              {points.map((p, index) => (
                <g key={index} className="cursor-pointer">
                  {/* Outer glow ring */}
                  <circle
                    cx={p.x * 1000}
                    cy={p.y * 1000}
                    r={activeDragIndex === index ? 16 : 12}
                    className="fill-red-500/30 stroke-red-400 stroke-2 transition-all duration-75"
                  />
                  {/* Center Dot */}
                  <circle
                    cx={p.x * 1000}
                    cy={p.y * 1000}
                    r={5}
                    className="fill-white"
                    onMouseDown={(e) => handleMouseDownPoint(index, e)}
                  />
                  {/* Point Index Tag */}
                  <text
                    x={p.x * 1000}
                    y={p.y * 1000}
                    dx={16}
                    dy={5}
                    fill="#ffffff"
                    fontSize="16"
                    fontWeight="bold"
                    className="pointer-events-none drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] select-none"
                  >
                    #{index + 1}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Coordinate Preview & Quick Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-gray-950/40 p-2.5 border border-gray-800 rounded-lg">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleUndo}
                disabled={points.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded-lg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Hoàn tác
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={points.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/40 disabled:opacity-50 rounded-lg transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa tất cả
              </button>

              <div className="h-4 w-px bg-gray-800 my-auto mx-1" />

              {/* Copy Points Button */}
              <button
                type="button"
                onClick={() => copyToClipboard(jsonFormatStr, "json")}
                disabled={points.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-950/40 hover:bg-blue-900/50 text-blue-300 border border-blue-800/40 disabled:opacity-50 rounded-lg transition"
                title="Sao chép danh sách tọa độ (JSON)"
              >
                {copiedFormat === "json" ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Đã chép!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Tọa độ
                  </>
                )}
              </button>

              {/* View All Modal Trigger */}
              <button
                type="button"
                onClick={() => setShowViewAllModal(true)}
                disabled={points.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 rounded-lg transition"
                title="Xem toàn bộ mảng tọa độ chi tiết"
              >
                <Eye className="w-3.5 h-3.5 text-purple-400" />
                Xem toàn bộ ({points.length})
              </button>
            </div>

            {/* Inline List of points summary */}
            <div className="text-gray-400 truncate max-w-sm">
              {points.length === 0 ? (
                <span>Chưa vẽ điểm nào.</span>
              ) : (
                <span className="font-mono text-[11px] text-gray-300">
                  {points.map((p, i) => `#${i + 1}(${p.x}, ${p.y})`).join("  ")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800 bg-gray-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition shadow-lg shadow-blue-600/20"
          >
            {saving ? (
              <span className="inline-block animate-spin border-2 border-white border-t-transparent rounded-full w-4 h-4" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Lưu Vùng Cấm
          </button>
        </div>
      </div>

      {/* Sub Modal: View & Copy All Coordinates */}
      {showViewAllModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs animate-fade-in">
          <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Code className="w-5 h-5 text-purple-400" />
                <span>Danh sách Tọa độ Vùng Cấm (ROI Points)</span>
              </h3>
              <button
                onClick={() => setShowViewAllModal(false)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs overflow-y-auto max-h-[70vh]">
              {/* Formatted Tuple list */}
              <div>
                <label className="text-gray-400 font-medium block mb-1.5">
                  Danh sách {points.length} đỉnh đa giác (Thứ tự vẽ):
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-gray-950 p-3 border border-gray-800 rounded-lg font-mono">
                  {points.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-gray-900/80 px-2.5 py-1.5 rounded border border-gray-800">
                      <span className="text-purple-400 font-bold">#{i + 1}:</span>
                      <span className="text-gray-200">({p.x}, {p.y})</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* JSON Format */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-gray-400 font-medium">Định dạng JSON (Web / API):</label>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(jsonFormatStr, "modal_json")}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
                  >
                    {copiedFormat === "modal_json" ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Đã chép
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy JSON
                      </span>
                    )}
                  </button>
                </div>
                <pre className="bg-gray-950 p-3 rounded-lg border border-gray-800 font-mono text-[11px] text-emerald-400 overflow-x-auto">
                  {jsonFormatStr}
                </pre>
              </div>

              {/* Python NumPy Format */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-gray-400 font-medium">Định dạng Python OpenCV (NumPy Array):</label>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(pythonFormatStr, "modal_python")}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-medium"
                  >
                    {copiedFormat === "modal_python" ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Đã chép
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy Python
                      </span>
                    )}
                  </button>
                </div>
                <pre className="bg-gray-950 p-3 rounded-lg border border-gray-800 font-mono text-[11px] text-amber-300 overflow-x-auto">
                  {pythonFormatStr}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-end px-6 py-4 border-t border-gray-800 bg-gray-900/50">
              <button
                type="button"
                onClick={() => setShowViewAllModal(false)}
                className="px-4 py-2 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
