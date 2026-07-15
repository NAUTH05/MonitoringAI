"use client";

import { api } from "@/lib/api";
import { AiModule, ApiResponse, Camera, CameraModule, PaginatedResponse } from "@/types";
import {
  Cpu,
  Power,
  PowerOff,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export default function ModulesPage() {
  const [modules, setModules] = useState<AiModule[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [assigned, setAssigned] = useState<CameraModule[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchModules = useCallback(async () => {
    const res = await api.get<ApiResponse<AiModule[]>>("/modules");
    if (res.success) setModules(res.data);
  }, []);

  const fetchCameras = useCallback(async () => {
    const res = await api.get<PaginatedResponse<Camera>>("/cameras?limit=100");
    if (res.success) {
      setCameras(res.data);
      if (res.data.length > 0) {
        setSelectedCameraId((prev) => prev || res.data[0].id);
      }
    }
  }, []);

  const fetchAssigned = useCallback(async (cameraId: string) => {
    if (!cameraId) {
      setAssigned([]);
      return;
    }
    const res = await api.get<ApiResponse<CameraModule[]>>(`/modules/camera/${cameraId}`);
    if (res.success) setAssigned(res.data);
  }, []);

  useEffect(() => {
    Promise.all([fetchModules(), fetchCameras()]).finally(() => setLoading(false));
  }, [fetchModules, fetchCameras]);

  useEffect(() => {
    fetchAssigned(selectedCameraId);
  }, [selectedCameraId, fetchAssigned]);

  const assignedMap = new Map(assigned.map((cm) => [cm.moduleId, cm]));

  const handleAssign = async (moduleId: string) => {
    setBusy(true);
    try {
      await api.post(`/modules/camera/${selectedCameraId}/${moduleId}`, {});
      await fetchAssigned(selectedCameraId);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (moduleId: string) => {
    setBusy(true);
    try {
      await api.delete(`/modules/camera/${selectedCameraId}/${moduleId}`);
      await fetchAssigned(selectedCameraId);
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (moduleId: string) => {
    setBusy(true);
    try {
      await api.patch(`/modules/camera/${selectedCameraId}/${moduleId}/toggle`);
      await fetchAssigned(selectedCameraId);
    } finally {
      setBusy(false);
    }
  };

  const filteredModules = modules.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.code.toLowerCase().includes(search.toLowerCase()) ||
      (m.description ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Cpu className="w-6 h-6 text-blue-500" />
            AI Modules
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {modules.length} detection modules available
          </p>
        </div>
        <button
          onClick={() => {
            fetchModules();
            fetchAssigned(selectedCameraId);
          }}
          className="p-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Modules catalog */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search modules..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="divide-y divide-gray-800 max-h-[520px] overflow-y-auto">
            {loading ? (
              <p className="p-6 text-center text-gray-500 text-sm">Loading...</p>
            ) : filteredModules.length === 0 ? (
              <p className="p-6 text-center text-gray-500 text-sm">No modules found</p>
            ) : (
              filteredModules.map((m) => (
                <div key={m.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{m.name}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {m.code}
                      </span>
                      {!m.isActive && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-500/10 text-gray-400 border border-gray-500/20">
                          inactive
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs mt-1">{m.description}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Assignment panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-800">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Assign modules to camera
            </label>
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="mt-2 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {cameras.length === 0 && <option value="">No cameras</option>}
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.location}
                </option>
              ))}
            </select>
          </div>

          <div className="divide-y divide-gray-800 max-h-[520px] overflow-y-auto">
            {!selectedCameraId ? (
              <p className="p-6 text-center text-gray-500 text-sm">Select a camera</p>
            ) : (
              modules.map((m) => {
                const cm = assignedMap.get(m.id);
                const isAssigned = !!cm;
                return (
                  <div key={m.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white text-sm">{m.name}</span>
                        {isAssigned && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                              cm!.isEnabled
                                ? "bg-green-500/10 text-green-400 border-green-500/20"
                                : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                            }`}
                          >
                            {cm!.isEnabled ? "enabled" : "disabled"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isAssigned ? (
                        <>
                          <button
                            disabled={busy}
                            onClick={() => handleToggle(m.id)}
                            className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded transition disabled:opacity-40"
                            title={cm!.isEnabled ? "Disable" : "Enable"}
                          >
                            {cm!.isEnabled ? (
                              <PowerOff className="w-4 h-4" />
                            ) : (
                              <Power className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => handleRemove(m.id)}
                            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition disabled:opacity-40"
                            title="Remove from camera"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => handleAssign(m.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white border border-blue-600/30 rounded text-xs font-semibold transition disabled:opacity-40"
                          title="Assign to camera"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Assign
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
