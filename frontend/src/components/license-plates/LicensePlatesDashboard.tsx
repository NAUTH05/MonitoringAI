"use client";

import { api } from "@/lib/api";
import { formatConfidence, formatDate } from "@/lib/utils";
import {
  Bike,
  Bus,
  Calendar,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Filter,
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

  // Filter States
  const [searchTerm, setSearchTerm] = useState("");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState("");
  const [plateColorFilter, setPlateColorFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

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

    let bgStyle = "bg-white text-gray-900 border-gray-300";
    if (isYellow) {
      bgStyle = "bg-amber-300 text-gray-950 border-amber-500 font-extrabold";
    } else if (isBlue) {
      bgStyle = "bg-blue-600 text-white border-blue-400 font-bold";
    }

    return (
      <div
        className={`inline-flex items-center gap-1 px-3 py-1 rounded-md font-mono text-sm border shadow-sm ${bgStyle}`}
      >
        <span className="tracking-wider">{plateText}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Car className="w-7 h-7 text-blue-500" />
            Giám sát Biển Số Xe (ANPR)
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Hệ thống tự động nhận diện và lưu trữ dữ liệu biển số xe từ camera AI
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3.5 py-2 rounded-lg transition text-sm font-medium shadow"
          >
            <Download className="w-4 h-4" />
            {exporting ? "Đang xuất..." : "Xuất file CSV"}
          </button>
          <button
            onClick={() => {
              fetchStats();
              fetchEvents();
            }}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3.5 py-2 rounded-lg transition text-sm border border-gray-700"
          >
            <RefreshCw className="w-4 h-4" />
            Làm mới
          </button>
        </div>
      </div>

      {/* Overview Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Tổng số lượt quét</p>
            <h3 className="text-2xl font-bold text-white mt-1">
              {stats ? stats.totalPlates.toLocaleString("vi-VN") : "..."}
            </h3>
            <p className="text-emerald-400 text-xs mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Tất cả sự kiện ANPR
            </p>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Lượt quét hôm nay</p>
            <h3 className="text-2xl font-bold text-white mt-1">
              {stats ? stats.todayPlates.toLocaleString("vi-VN") : "..."}
            </h3>
            <p className="text-blue-400 text-xs mt-1">Cập nhật trong ngày</p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Calendar className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Ô tô ghi nhận</p>
            <h3 className="text-2xl font-bold text-white mt-1">
              {stats
                ? (stats.vehicleTypes.find((v) => v.type.toLowerCase() === "car")?.count || 0).toLocaleString("vi-VN")
                : "..."}
            </h3>
            <p className="text-gray-400 text-xs mt-1">Phương tiện 4 bánh</p>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 text-blue-400">
            <Car className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">Xe máy ghi nhận</p>
            <h3 className="text-2xl font-bold text-white mt-1">
              {stats
                ? (
                    stats.vehicleTypes.find(
                      (v) => v.type.toLowerCase() === "motorcycle" || v.type.toLowerCase() === "motorbike"
                    )?.count || 0
                  ).toLocaleString("vi-VN")
                : "..."}
            </h3>
            <p className="text-gray-400 text-xs mt-1">Phương tiện 2 bánh</p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
            <Bike className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Nhập biển số xe cần tìm (vd: 72LD17781, 60X64690)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
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
              <option value="car">Ô tô (Car)</option>
              <option value="motorcycle">Xe máy (Motorcycle)</option>
              <option value="truck">Xe tải (Truck)</option>
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
            </select>

            {/* Date Filters */}
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <span className="text-gray-500 text-xs">đến</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4 p-6 relative">
            <button
              onClick={() => setSelectedEvent(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white bg-gray-800/80 p-1.5 rounded-full transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <Car className="w-6 h-6 text-blue-400" />
              <div>
                <h3 className="text-lg font-bold text-white">Chi tiết sự kiện ANPR</h3>
                <p className="text-xs text-gray-400">ID: {selectedEvent.id}</p>
              </div>
            </div>

            <div className="p-4 bg-gray-950 rounded-xl border border-gray-800 text-center space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Biển số xe nhận diện</p>
              <div className="inline-block">{renderPlateBadge(selectedEvent.plateText, selectedEvent.plateColor)}</div>
            </div>

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

            {selectedEvent.imagePath && (
              <div className="bg-gray-950 p-3 rounded-lg border border-gray-800 space-y-1">
                <span className="text-xs text-gray-500 block">Đường dẫn ảnh bằng chứng</span>
                <span className="font-mono text-xs text-blue-400 break-all">{selectedEvent.imagePath}</span>
              </div>
            )}

            <div className="pt-2 text-right">
              <button
                onClick={() => setSelectedEvent(null)}
                className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-4 py-2 rounded-lg text-sm transition"
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
