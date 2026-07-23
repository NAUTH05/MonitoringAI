"use client";

import { CameraFormDialog } from "@/components/cameras/CameraFormDialog";
import { api } from "@/lib/api";
import { cn, formatDate, getStatusColor } from "@/lib/utils";
import { Camera, PaginatedResponse } from "@/types";
import {
  AlertCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function CamerasPage() {
  const { t } = useTranslation();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editCamera, setEditCamera] = useState<Camera | undefined>();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const limit = 10;

  const fetchCameras = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter }),
      });
      const res = await api.get<PaginatedResponse<Camera>>(
        `/cameras?${params}`,
      );
      if (res.success) {
        setCameras(res.data);
        setTotal(res.meta.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const handleDelete = async (id: string) => {
    if (!confirm(t("cameras.deleteConfirm"))) return;
    await api.delete(`/cameras/${id}`);
    fetchCameras();
  };

  const statusIcon = (status: string) => {
    if (status === "ONLINE") return <Wifi className="w-3.5 h-3.5" />;
    if (status === "OFFLINE") return <WifiOff className="w-3.5 h-3.5" />;
    return <AlertCircle className="w-3.5 h-3.5" />;
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("cameras.title")}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {t("cameras.registered", { total })}
          </p>
        </div>
        <button
          onClick={() => {
            setEditCamera(undefined);
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition text-sm"
        >
          <Plus className="w-4 h-4" />
          {t("cameras.addCamera")}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("cameras.searchPlaceholder")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">{t("cameras.allStatus")}</option>
          <option value="ONLINE">{t("cameras.statusOnline")}</option>
          <option value="OFFLINE">{t("cameras.statusOffline")}</option>
          <option value="ERROR">{t("cameras.statusError")}</option>
        </select>
        <button
          onClick={fetchCameras}
          className="p-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/50">
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("cameras.colName")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("cameras.colLocation")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("cameras.colRtsp")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("cameras.colStatus")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("cameras.colModules")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("cameras.colCreated")}
                </th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("cameras.colActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-gray-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : cameras.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-500">
                    {t("cameras.noCameras")}
                  </td>
                </tr>
              ) : (
                cameras.map((cam) => (
                  <tr key={cam.id} className="hover:bg-gray-800/40 transition">
                    <td className="px-4 py-4 font-medium text-white">
                      {cam.name}
                    </td>
                    <td className="px-4 py-4 text-gray-300">{cam.location}</td>
                    <td className="px-4 py-4">
                      <span className="font-mono text-xs text-gray-400 truncate max-w-48 block">
                        {cam.rtspUrl}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                          getStatusColor(cam.status),
                        )}
                      >
                        {statusIcon(cam.status)}
                        {cam.status === "ONLINE" ? t("cameras.statusOnline") : cam.status === "OFFLINE" ? t("cameras.statusOffline") : t("cameras.statusError")}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-300">
                      {t("cameras.modulesCount", {
                        count: cam.cameraModules?.length ?? 0,
                      })}
                    </td>
                    <td className="px-4 py-4 text-gray-400 text-xs">
                      {formatDate(cam.createdAt)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditCamera(cam);
                            setShowForm(true);
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(cam.id)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition"
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-xs text-gray-400">
              {t("common.showingRange", {
                from: (page - 1) * limit + 1,
                to: Math.min(page * limit, total),
                total,
              })}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <CameraFormDialog
          camera={editCamera}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            fetchCameras();
          }}
        />
      )}
    </div>
  );
}
