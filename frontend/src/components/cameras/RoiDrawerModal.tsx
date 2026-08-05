"use client";

import { Go2RtcPlayer } from "@/components/cameras/Go2RtcPlayer";
import { api } from "@/lib/api";
import { ApiResponse, Camera, CameraModule } from "@/types";
import { Check, Move, RotateCcw, Trash2, X } from "lucide-react";
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
    }
  }, [isOpen, cameraModule]);

  // Convert mouse event coordinates to normalized [0, 1]
  const getNormalizedPoint = useCallback((e: React.MouseEvent<SVGSVGElement>): Point | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    // Round to 4 decimal places for precision
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

    // Check if clicked close to an existing point to avoid adding double point
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

  const handleRemovePoint = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPoints((prev) => prev.filter((_, i) => i !== index));
    if (activeDragIndex === index) setActiveDragIndex(null);
  };

  const handleUndo = () => {
    setPoints((prev) => prev.slice(0, -1));
  };

  const handleReset = () => {
    setPoints([]);
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

  // Build SVG polygon points attribute string "x1%,y1% x2%,y2% ..."
  const polygonPointsStr = points.map((p) => `${p.x * 100}%,${p.y * 100}%`).join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
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
              Camera: <span className="text-gray-200 font-medium">{camera.name}</span> ({camera.location})
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
          {/* Instructions */}
          <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Move className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                Click chuột lên khung video để thêm các đỉnh đa giác. Kéo thả vòng tròn đỏ để điều chỉnh vị trí đỉnh.
              </span>
            </div>
            <span className="font-mono bg-blue-900/60 px-2 py-0.5 rounded text-blue-200 font-medium">
              {points.length} điểm
            </span>
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
            {/* Live Video Player */}
            <Go2RtcPlayer streamName={camera.id} active={isOpen} className="w-full h-full object-contain" />

            {/* SVG Drawing Layer */}
            <svg
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
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              )}

              {/* Polylines for < 3 points */}
              {points.length > 1 && points.length < 3 && (
                <polyline
                  points={polygonPointsStr}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              )}

              {/* Point Circles & Drag Handles */}
              {points.map((p, index) => (
                <g key={index} className="cursor-pointer">
                  {/* Outer glow ring */}
                  <circle
                    cx={`${p.x * 100}%`}
                    cy={`${p.y * 100}%`}
                    r={activeDragIndex === index ? "12" : "8"}
                    className="fill-red-500/30 stroke-red-400 stroke-2 transition-all duration-75"
                  />
                  {/* Center Dot */}
                  <circle
                    cx={`${p.x * 100}%`}
                    cy={`${p.y * 100}%`}
                    r="4"
                    className="fill-white"
                    onMouseDown={(e) => handleMouseDownPoint(index, e)}
                  />
                  {/* Point Index Tag */}
                  <text
                    x={`${p.x * 100}%`}
                    y={`${p.y * 100}%`}
                    dx="12"
                    dy="4"
                    fill="#ffffff"
                    fontSize="11"
                    fontWeight="bold"
                    className="pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                  >
                    #{index + 1}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Coordinate Preview & Quick Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
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
            </div>

            {/* List of points summary */}
            <div className="text-gray-400 truncate max-w-md">
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
    </div>
  );
}
