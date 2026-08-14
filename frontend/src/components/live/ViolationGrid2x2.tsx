"use client";

import { formatDate } from "@/lib/utils";
import { AlertTriangle, Car, Camera as CameraIcon, Clock, MapPin, Maximize2, ShieldAlert, X, ZoomIn } from "lucide-react";
import { useState } from "react";

export interface ViolationItem {
  id: string;
  location: string;
  violationType: string;
  timestamp: string;
  licensePlate: string;
  plateColor?: string;
  imageUrl: string;
  boundingBox?: { x: number; y: number; w: number; h: number }; // percentage relative
  confidence: number;
}

const DEFAULT_MOCK_VIOLATIONS: ViolationItem[] = [
  {
    id: "viol-001",
    location: "Cổng chính - Trạm 01",
    violationType: "Vượt đèn đỏ",
    timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    licensePlate: "51H-892.34",
    plateColor: "white",
    imageUrl: "/evidence/sample-vehicle.svg",
    boundingBox: { x: 25, y: 30, w: 45, h: 40 },
    confidence: 0.94,
  },
  {
    id: "viol-002",
    location: "Bãi xe A - Khu B",
    violationType: "Dừng đỗ trái phép",
    timestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    licensePlate: "29A-567.89",
    plateColor: "yellow",
    imageUrl: "/evidence/sample-intrusion.svg",
    boundingBox: { x: 30, y: 20, w: 40, h: 50 },
    confidence: 0.91,
  },
  {
    id: "viol-003",
    location: "Đường nội bộ 2",
    violationType: "Phát hiện ngập nước",
    timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    licensePlate: "60B-123.45",
    plateColor: "white",
    imageUrl: "/evidence/sample-fire.svg",
    boundingBox: { x: 15, y: 45, w: 70, h: 35 },
    confidence: 0.88,
  },
  {
    id: "viol-004",
    location: "Ngã tư trung tâm",
    violationType: "Đi sai làn đường",
    timestamp: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    licensePlate: "43C-999.88",
    plateColor: "blue",
    imageUrl: "/evidence/sample-vehicle.svg",
    boundingBox: { x: 40, y: 35, w: 35, h: 40 },
    confidence: 0.96,
  },
];

interface ViolationGrid2x2Props {
  violations?: ViolationItem[];
}

export function ViolationGrid2x2({ violations = DEFAULT_MOCK_VIOLATIONS }: ViolationGrid2x2Props) {
  const [selectedViolation, setSelectedViolation] = useState<ViolationItem | null>(null);

  const displayList = (violations.length >= 4 ? violations : [...violations, ...DEFAULT_MOCK_VIOLATIONS]).slice(0, 4);

  const renderPlateBadge = (plateText: string, plateColor: string = "white") => {
    let bgStyle = "bg-white text-gray-900 border-gray-300";
    if (plateColor === "yellow") bgStyle = "bg-amber-400 text-gray-950 border-amber-500 font-bold";
    if (plateColor === "blue") bgStyle = "bg-blue-600 text-white border-blue-400 font-bold";
    if (plateColor === "red") bgStyle = "bg-red-600 text-white border-red-400 font-bold";

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono tracking-wider border shadow-sm ${bgStyle}`}>
        {plateText}
      </span>
    );
  };

  return (
    <div className="h-full flex flex-col space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-500" />
          Màn hình trực tiếp vi phạm 2x2 (Live Snapshot Grid)
        </h2>
        <span className="text-xs text-neutral-400">Tự động cập nhật trực tiếp từ Camera AI</span>
      </div>

      {/* 2x2 Grid Container */}
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 min-h-0">
        {displayList.map((item, index) => (
          <div
            key={`${item.id}-${index}`}
            onClick={() => setSelectedViolation(item)}
            className="group relative bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden flex flex-col cursor-pointer hover:border-red-500/60 hover:ring-2 hover:ring-red-500/20 transition duration-200"
          >
            {/* Top Info Bar */}
            <div className="px-3 py-2 bg-neutral-950/90 border-b border-neutral-800/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <MapPin className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="text-xs font-semibold text-neutral-200 truncate">{item.location}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                  {item.violationType}
                </span>
              </div>
            </div>

            {/* Main Snapshot Image with Bounding Box Overlay */}
            <div className="flex-1 min-h-0 relative bg-neutral-950 flex items-center justify-center overflow-hidden">
              <img
                src={item.imageUrl}
                alt={item.violationType}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              />

              {/* Bounding box target (khoanh vùng xe vi phạm) */}
              {item.boundingBox && (
                <div
                  className="absolute border-2 border-red-500 bg-red-500/10 rounded animate-pulse"
                  style={{
                    left: `${item.boundingBox.x}%`,
                    top: `${item.boundingBox.y}%`,
                    width: `${item.boundingBox.w}%`,
                    height: `${item.boundingBox.h}%`,
                  }}
                >
                  <div className="absolute -top-5 left-0 bg-red-600 text-white text-[9px] font-bold font-mono px-1 rounded">
                    VIOLATION TARGET
                  </div>
                </div>
              )}

              {/* Overlay hover zoom button */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition duration-200 flex items-center justify-center">
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900/90 text-white text-xs font-medium border border-neutral-700 shadow-xl">
                  <ZoomIn className="w-4 h-4 text-blue-400" /> Phóng to chi tiết
                </span>
              </div>
            </div>

            {/* Bottom Meta Bar */}
            <div className="px-3 py-2 bg-neutral-950/90 border-t border-neutral-800/80 flex items-center justify-between shrink-0 text-xs">
              <div className="flex items-center gap-1.5 text-neutral-400 font-mono text-[11px]">
                <Clock className="w-3.5 h-3.5 text-neutral-500" />
                {formatDate(item.timestamp)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-500">Biển số:</span>
                {renderPlateBadge(item.licensePlate, item.plateColor)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Interactive Zoom Lightbox Modal */}
      {selectedViolation && (
        <div
          onClick={() => setSelectedViolation(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-3xl w-full p-6 space-y-4 shadow-2xl relative"
          >
            <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  Chi tiết ảnh vi phạm (Phóng to)
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {selectedViolation.location} · {selectedViolation.violationType}
                </p>
              </div>
              <button
                onClick={() => setSelectedViolation(null)}
                className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* High-res Image View with Bounding Box */}
            <div className="relative bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 aspect-video flex items-center justify-center">
              <img
                src={selectedViolation.imageUrl}
                alt={selectedViolation.violationType}
                className="max-h-full max-w-full object-contain"
              />
              {selectedViolation.boundingBox && (
                <div
                  className="absolute border-2 border-red-500 bg-red-500/20 rounded"
                  style={{
                    left: `${selectedViolation.boundingBox.x}%`,
                    top: `${selectedViolation.boundingBox.y}%`,
                    width: `${selectedViolation.boundingBox.w}%`,
                    height: `${selectedViolation.boundingBox.h}%`,
                  }}
                >
                  <div className="absolute -top-6 left-0 bg-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded shadow">
                    Xe vi phạm ({(selectedViolation.confidence * 100).toFixed(0)}%)
                  </div>
                </div>
              )}
            </div>

            {/* Detailed Metadata Footer */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">Địa điểm</span>
                <span className="font-semibold text-neutral-200 mt-0.5 block truncate">
                  {selectedViolation.location}
                </span>
              </div>
              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">Loại vi phạm</span>
                <span className="font-bold text-red-400 mt-0.5 block">
                  {selectedViolation.violationType}
                </span>
              </div>
              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">Thời gian</span>
                <span className="font-mono text-neutral-300 mt-0.5 block text-[11px]">
                  {formatDate(selectedViolation.timestamp)}
                </span>
              </div>
              <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800">
                <span className="text-[10px] text-neutral-500 block">Biển số xe</span>
                <div className="mt-1">
                  {renderPlateBadge(selectedViolation.licensePlate, selectedViolation.plateColor)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
