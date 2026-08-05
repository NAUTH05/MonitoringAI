"use client";

import { api } from "@/lib/api";
import { formatConfidence, formatDate } from "@/lib/utils";
import {
  Bike,
  Bus,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Filter,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

export interface LicensePlateEvent {
  id: string;
  streamId: string;
  taskName: string;
  eventTime: string;
  plateText: string;
  vehicleType: string;
  plateColor: string;
  confidence: number;
  imagePath: string | null;
  thumbnailPath: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  createdAt: string;
}

export interface LicensePlateStats {
  totalPlates: number;
  todayPlates: number;
  vehicleTypes: { type: string; count: number }[];
  plateColors: { color: string; count: number }[];
}

export function LicensePlatesDashboard() {
  const [events, setEvents] = useState<LicensePlateEvent[]>([]);
  const [stats, setStats] = useState<LicensePlateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [selectedEvent, setSelectedEvent] = useState<LicensePlateEvent | null>(null);

  // Image viewer states
  const [copied, setCopied] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  // Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState("");
  const [plateColorFilter, setPlateColorFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  const getMediaUrl = (path: string | null, directUrl?: string | null) => {
    let url = directUrl || (path ? `/api/aicam-media/${path}` : null);
    if (!url) return null;

    if (typeof window !== "undefined" && (url.includes("localhost") || url.includes("127.0.0.1"))) {
      url = url.replace(/localhost|127\.0\.0\.1/g, window.location.hostname);
    }
    return url;
  };

  useEffect(() => {
    if (selectedEvent) {
      setImageError(false);
      setCopied(false);
      setIsZoomed(false);
    }
  }, [selectedEvent]);

  const handleCopyPath = () => {
    if (selectedEvent?.imagePath) {
      navigator.clipboard.writeText(selectedEvent.imagePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: LicensePlateStats }>("/license-plates/stats");
      if (res.success) {
        setStats(res.data);
      }
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(searchTerm && { search: searchTerm }),
        ...(vehicleTypeFilter && { vehicleType: vehicleTypeFilter }),
        ...(plateColorFilter && { plateColor: plateColorFilter }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });

      const res = await api.get<{
        success: boolean;
        data: LicensePlateEvent[];
        meta: { total: number; page: number; limit: number; totalPages: number };
      }>(`/license-plates?${params}`);

      if (res.success) {
        setEvents(res.data);
        setTotal(res.meta.total);
      }
    } catch (err) {
      console.error("Failed to load license plates:", err);
    } finally {
      setLoading(false);
    }
  }, [page, limit, searchTerm, vehicleTypeFilter, plateColorFilter, startDate, endDate]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchEvents();
  };

  const handleResetFilters = () => {
    setSearchTerm("");
    setVehicleTypeFilter("");
    setPlateColorFilter("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        ...(searchTerm && { search: searchTerm }),
        ...(vehicleTypeFilter && { vehicleType: vehicleTypeFilter }),
        ...(plateColorFilter && { plateColor: plateColorFilter }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      });

      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const response = await fetch(`/api/license-plates/export?${params}`, {
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bien_so_xe_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  // Helper icons and styles for Vehicle Types
  const getVehicleTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "car":
        return <Car className="w-4 h-4 text-blue-400" />;
      case "motorcycle":
      case "motorbike":
        return <Bike className="w-4 h-4 text-emerald-400" />;
      case "truck":
        return <Truck className="w-4 h-4 text-amber-400" />;
      case "bus":
        return <Bus className="w-4 h-4 text-purple-400" />;
      default:
        return <Car className="w-4 h-4 text-gray-400" />;
    }
  };

  const getVehicleTypeLabel = (type: string) => {
    switch (type.toLowerCase()) {
      case "car":
        return "Ô tô";
      case "motorcycle":
      case "motorbike":
        return "Xe máy";
      case "truck":
        return "Xe tải";
      case "bus":
        return "Xe khách/Bus";
      default:
        return type || "Chưa xác định";
    }
  };

  // Render License Plate Badge
  const renderPlateBadge = (plateText: string, plateColor: string) => {
    const isYellow = plateColor?.toLowerCase() === "yellow";
    const isBlue = plateColor?.toLowerCase() === "blue";
    const isRed = plateColor?.toLowerCase() === "red";

    let bgStyle = "bg-white text-gray-900 border-gray-300";
    if (isYellow) bgStyle = "bg-amber-400 text-gray-950 border-amber-500 font-bold";
    if (isBlue) bgStyle = "bg-blue-600 text-white border-blue-400 font-bold";
    if (isRed) bgStyle = "bg-red-600 text-white border-red-400 font-bold";

    return (
      <span
        className={`inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-mono tracking-widest uppercase border-2 shadow-sm ${bgStyle}`}
      >
        {plateText || "N/A"}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Car className="w-7 h-7 text-blue-500" />
            Nhận diện Biển số xe (ANPR)
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Quản lý và tra cứu thông tin phương tiện, biển số xe ghi nhận từ hệ thống AI Camera
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          disabled={exporting || events.length === 0}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition shadow-lg shadow-blue-500/20"
        >
          <Download className="w-4 h-4" />
          {exporting ? "Đang xuất CSV..." : "Xuất báo cáo CSV"}
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 font-medium">Tổng biển số ghi nhận</p>
              <h3 className="text-2xl font-bold text-white mt-1">{stats.totalPlates.toLocaleString()}</h3>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
              <Car className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 font-medium">Ghi nhận hôm nay</p>
              <h3 className="text-2xl font-bold text-emerald-400 mt-1">{stats.todayPlates.toLocaleString()}</h3>
            </div>
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 font-medium">Loại xe phổ biến</p>
              <h3 className="text-lg font-bold text-white mt-1 capitalize">
                {getVehicleTypeLabel(stats.vehicleTypes[0]?.type || "")}
              </h3>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-xl text-purple-400 border border-purple-500/20">
              <Truck className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 font-medium">Màu biển phổ biến</p>
              <h3 className="text-lg font-bold text-white mt-1 capitalize">
                {stats.plateColors[0]?.color || "N/A"}
              </h3>
            </div>
            <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400 border border-amber-500/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col lg:flex-row gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              placeholder="Nhập biển số xe cần tìm (Ví dụ: 50H, 80A...)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Vehicle Type Filter */}
            <select
              value={vehicleTypeFilter}
              onChange={(e) => {
                setVehicleTypeFilter(e.target.value);
                setPage(1);
              }}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="">Tất cả loại xe</option>
              <option value="car">Ô tô</option>
              <option value="motorcycle">Xe máy</option>
              <option value="truck">Xe tải</option>
              <option value="bus">Xe khách/Bus</option>
            </select>

            {/* Plate Color Filter */}
            <select
              value={plateColorFilter}
              onChange={(e) => {
                setPlateColorFilter(e.target.value);
                setPage(1);
              }}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="">Tất cả màu biển</option>
              <option value="white">Biển trắng</option>
              <option value="yellow">Biển vàng</option>
              <option value="blue">Biển xanh</option>
              <option value="red">Biển đỏ</option>
            </select>

            {/* Start Date */}
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />

            {/* End Date */}
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />

            {/* Reset Filters */}
            {(searchTerm || vehicleTypeFilter || plateColorFilter || startDate || endDate) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white px-3 py-2 rounded-lg text-sm transition"
              >
                <X className="w-4 h-4" /> Bỏ lọc
              </button>
            )}

            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm transition font-medium"
            >
              Tìm kiếm
            </button>
          </div>
        </form>
      </div>

      {/* Main Data Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 text-center text-gray-400">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-3" />
            <p className="text-sm">Đang tải danh sách biển số xe...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <Filter className="w-10 h-10 mx-auto text-gray-600 mb-2 opacity-50" />
            <p className="text-base font-medium text-gray-300">Không tìm thấy biển số xe nào</p>
            <p className="text-xs text-gray-500 mt-1">Thử điều chỉnh từ khóa tìm kiếm hoặc bỏ các bộ lọc</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-300">
              <thead className="bg-gray-950/80 border-b border-gray-800 text-xs text-gray-400 uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Biển số xe</th>
                  <th className="py-3.5 px-4 font-semibold">Ảnh bằng chứng</th>
                  <th className="py-3.5 px-4 font-semibold">Loại phương tiện</th>
                  <th className="py-3.5 px-4 font-semibold">Độ tin cậy AI</th>
                  <th className="py-3.5 px-4 font-semibold">Thời gian ghi nhận</th>
                  <th className="py-3.5 px-4 font-semibold">Camera Stream ID</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Chi tiết</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {events.map((event) => (
                  <tr key={event.id} className="hover:bg-gray-800/40 transition">
                    {/* Plate Badge */}
                    <td className="py-3.5 px-4">
                      {renderPlateBadge(event.plateText, event.plateColor)}
                    </td>

                    {/* Evidence Thumbnail */}
                    <td className="py-3.5 px-4">
                      {event.thumbnailPath || event.imagePath ? (
                        <div
                          onClick={() => setSelectedEvent(event)}
                          title="Nhấn để xem ảnh phóng to"
                          className="w-16 h-10 bg-gray-950 border border-gray-800 rounded-lg overflow-hidden cursor-pointer hover:border-blue-500 hover:ring-2 hover:ring-blue-500/30 transition relative group"
                        >
                          <img
                            src={getMediaUrl(event.thumbnailPath || event.imagePath, event.thumbnailUrl || event.imageUrl)!}
                            alt={event.plateText || "Ảnh biển số"}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                              const parent = (e.target as HTMLElement).parentElement;
                              if (parent) {
                                parent.classList.add("flex", "items-center", "justify-center");
                                parent.innerHTML = `<span class="text-[10px] text-gray-500 font-mono">No img</span>`;
                              }
                            }}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500 italic">Không có ảnh</span>
                      )}
                    </td>

                    {/* Vehicle Type */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        {getVehicleTypeIcon(event.vehicleType)}
                        <span className="font-medium text-gray-200">
                          {getVehicleTypeLabel(event.vehicleType)}
                        </span>
                      </div>
                    </td>

                    {/* Confidence Bar */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-24 bg-gray-950 rounded-full h-2 overflow-hidden border border-gray-800">
                          <div
                            className={`h-full rounded-full ${
                              (event.confidence || 0) >= 0.7
                                ? "bg-emerald-500"
                                : (event.confidence || 0) >= 0.5
                                ? "bg-amber-500"
                                : "bg-red-500"
                            }`}
                            style={{ width: `${Math.min(100, (event.confidence || 0) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-gray-400">
                          {formatConfidence(event.confidence || 0)}
                        </span>
                      </div>
                    </td>

                    {/* Event Time */}
                    <td className="py-3.5 px-4 text-gray-300 font-mono text-xs">
                      {formatDate(event.eventTime)}
                    </td>

                    {/* Stream ID */}
                    <td className="py-3.5 px-4 font-mono text-xs text-gray-400 max-w-[160px] truncate">
                      {event.streamId}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setSelectedEvent(event)}
                        className="inline-flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs transition border border-gray-700"
                      >
                        <Eye className="w-3.5 h-3.5 text-blue-400" />
                        Xem
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {total > 0 && (
          <div className="px-4 py-3 bg-gray-950/80 border-t border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
            <div>
              Hiển thị <span className="font-semibold text-gray-200">{(page - 1) * limit + 1}</span>–
              <span className="font-semibold text-gray-200">{Math.min(page * limit, total)}</span> trên{" "}
              <span className="font-semibold text-gray-200">{total}</span> kết quả
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg transition"
              >
                <ChevronLeft className="w-4 h-4" /> Trước
              </button>
              <span className="font-mono px-2 py-1 bg-gray-900 rounded border border-gray-800 text-gray-200">
                {page} / {totalPages || 1}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg transition"
              >
                Sau <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal Dialog */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl space-y-4 p-6 relative max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  <Car className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Chi tiết sự kiện ANPR</h3>
                  <p className="text-xs font-mono text-gray-400">ID: {selectedEvent.id}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedEvent(null);
                  setIsZoomed(false);
                }}
                className="text-gray-400 hover:text-white bg-gray-800/80 hover:bg-gray-700 p-2 rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Identified Plate Badge */}
            <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 text-center space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Biển số xe nhận diện</p>
              <div className="inline-block scale-110">{renderPlateBadge(selectedEvent.plateText, selectedEvent.plateColor)}</div>
            </div>

            {/* EVIDENCE IMAGE VIEWER CONTAINER */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Ảnh bằng chứng (ANPR Snapshot)</span>
                </div>
                {selectedEvent.imagePath && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleCopyPath}
                      title="Sao chép đường dẫn file"
                      className="inline-flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded-lg border border-gray-700 transition"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                      {copied ? "Đã chép" : "Chép path"}
                    </button>
                    <a
                      href={getMediaUrl(selectedEvent.imagePath, selectedEvent.imageUrl)!}
                      target="_blank"
                      rel="noreferrer"
                      title="Mở ảnh trong tab mới"
                      className="inline-flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded-lg border border-gray-700 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                      Mở ảnh
                    </a>
                  </div>
                )}
              </div>

              {/* Main Image Frame */}
              <div className="relative group bg-gray-950 rounded-xl border border-gray-800 overflow-hidden aspect-video flex items-center justify-center">
                {selectedEvent.imagePath ? (
                  <>
                    {!imageError ? (
                      <>
                        <img
                          src={getMediaUrl(selectedEvent.imagePath, selectedEvent.imageUrl)!}
                          alt={`Bằng chứng biển số ${selectedEvent.plateText}`}
                          className="w-full h-full object-contain cursor-zoom-in transition-transform duration-300 group-hover:scale-[1.01]"
                          onClick={() => setIsZoomed(true)}
                          onError={() => setImageError(true)}
                        />
                        <button
                          onClick={() => setIsZoomed(true)}
                          className="absolute bottom-3 right-3 bg-gray-900/80 hover:bg-gray-900 text-white p-2 rounded-lg backdrop-blur border border-gray-700/80 opacity-0 group-hover:opacity-100 transition duration-200 flex items-center gap-1.5 text-xs font-medium"
                          title="Phóng to ảnh"
                        >
                          <Maximize2 className="w-4 h-4" /> Phóng to
                        </button>
                      </>
                    ) : (
                      /* Fallback layout if image fails to load */
                      <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
                        <div className="p-3 bg-amber-500/10 rounded-full border border-amber-500/20 text-amber-400">
                          <ImageIcon className="w-8 h-8" />
                        </div>
                        <p className="text-sm font-semibold text-gray-300">Không tải được ảnh trên đĩa máy chủ</p>
                        <p className="text-xs text-gray-500 max-w-md">
                          Vui lòng kiểm tra lại cấu hình MinIO hoặc file vật lý tại đường dẫn:
                        </p>
                        <span className="font-mono text-[11px] bg-gray-900 px-3 py-1.5 rounded-lg border border-gray-800 text-blue-400 break-all block mt-1">
                          {selectedEvent.imagePath}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center text-gray-500 p-6">
                    <p className="text-sm">Không có dữ liệu hình ảnh cho sự kiện này</p>
                  </div>
                )}
              </div>
            </div>

            {/* Event Meta Grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800/80">
                <span className="text-xs text-gray-500 block">Loại phương tiện</span>
                <span className="font-semibold text-gray-200 mt-0.5 block">
                  {getVehicleTypeLabel(selectedEvent.vehicleType)}
                </span>
              </div>

              <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800/80">
                <span className="text-xs text-gray-500 block">Màu biển số</span>
                <span className="font-semibold text-gray-200 mt-0.5 block capitalize">
                  {selectedEvent.plateColor || "Chưa xác định"}
                </span>
              </div>

              <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800/80">
                <span className="text-xs text-gray-500 block">Độ tin cậy AI</span>
                <span className="font-semibold text-emerald-400 mt-0.5 block">
                  {formatConfidence(selectedEvent.confidence)}
                </span>
              </div>

              <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800/80">
                <span className="text-xs text-gray-500 block">Thời gian phát hiện</span>
                <span className="font-semibold text-gray-200 mt-0.5 block font-mono text-xs">
                  {formatDate(selectedEvent.eventTime)}
                </span>
              </div>
            </div>

            <div className="bg-gray-950/60 p-3 rounded-lg border border-gray-800/80 space-y-1">
              <span className="text-xs text-gray-500 block">Stream ID / Nguồn Camera</span>
              <span className="font-mono text-xs text-gray-300 break-all">{selectedEvent.streamId}</span>
            </div>

            <div className="pt-2 text-right">
              <button
                onClick={() => {
                  setSelectedEvent(null);
                  setIsZoomed(false);
                }}
                className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-5 py-2 rounded-lg text-sm transition font-medium"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Lightbox */}
      {isZoomed && selectedEvent?.imagePath && !imageError && (
        <div
          onClick={() => setIsZoomed(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/95 backdrop-blur-sm animate-in fade-in duration-150 cursor-zoom-out"
        >
          <button
            onClick={() => setIsZoomed(false)}
            className="absolute top-4 right-4 text-gray-300 hover:text-white bg-gray-800/80 hover:bg-gray-700 p-2 rounded-full transition"
            title="Đóng"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={getMediaUrl(selectedEvent.imagePath, selectedEvent.imageUrl)!}
            alt={`Bằng chứng biển số ${selectedEvent.plateText}`}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-default"
          />
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2">
            <div className="inline-block">{renderPlateBadge(selectedEvent.plateText, selectedEvent.plateColor)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
