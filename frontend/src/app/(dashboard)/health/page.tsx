"use client";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ApiResponse, SystemHealth } from "@/types";
import {
  CheckCircle,
  Clock,
  HardDrive,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HealthMetricProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

function HealthMetric({ label, value, icon }: HealthMetricProps) {
  return (
    <div className="bg-gray-800/60 rounded-xl p-4 flex items-center gap-4">
      <div className="text-blue-400">{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-base font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

function parsePercent(val: string): number {
  return parseFloat(val.replace("%", "")) || 0;
}

function UsageBar({ value, label }: { value: string; label: string }) {
  const pct = parsePercent(value);
  const color =
    pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex justify-between mb-3">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span
          className={cn(
            "text-sm font-bold",
            pct > 80
              ? "text-red-400"
              : pct > 60
                ? "text-yellow-400"
                : "text-green-400",
          )}
        >
          {value}
        </span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            color,
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<ApiResponse<SystemHealth>>("/health");
      if (res.success) {
        setHealth(res.data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load health data",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">System Health</h1>
          <p className="text-gray-400 text-sm mt-1">
            {lastUpdated
              ? `Last updated: ${lastUpdated.toLocaleTimeString()}`
              : "Loading..."}
          </p>
        </div>
        <button
          onClick={fetchHealth}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2.5 rounded-lg transition text-sm border border-gray-700"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {loading && !health ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <XCircle className="w-10 h-10 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      ) : health ? (
        <>
          {/* Status cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              className={cn(
                "border rounded-xl p-5 flex items-center gap-4",
                health.server.status === "OK"
                  ? "bg-green-900/20 border-green-800/50"
                  : "bg-red-900/20 border-red-800/50",
              )}
            >
              {health.server.status === "OK" ? (
                <CheckCircle className="w-8 h-8 text-green-400" />
              ) : (
                <XCircle className="w-8 h-8 text-red-400" />
              )}
              <div>
                <p className="text-sm text-gray-400">Server Status</p>
                <p
                  className={cn(
                    "text-xl font-bold",
                    health.server.status === "OK"
                      ? "text-green-400"
                      : "text-red-400",
                  )}
                >
                  {health.server.status}
                </p>
              </div>
            </div>
            <div
              className={cn(
                "border rounded-xl p-5 flex items-center gap-4",
                health.database.status === "OK"
                  ? "bg-green-900/20 border-green-800/50"
                  : "bg-red-900/20 border-red-800/50",
              )}
            >
              {health.database.status === "OK" ? (
                <CheckCircle className="w-8 h-8 text-green-400" />
              ) : (
                <XCircle className="w-8 h-8 text-red-400" />
              )}
              <div>
                <p className="text-sm text-gray-400">Database Status</p>
                <p
                  className={cn(
                    "text-xl font-bold",
                    health.database.status === "OK"
                      ? "text-green-400"
                      : "text-red-400",
                  )}
                >
                  {health.database.status}
                </p>
              </div>
            </div>
          </div>

          {/* Usage bars */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UsageBar value={health.server.cpuUsage} label="CPU Usage" />
            <UsageBar value={health.server.memUsage} label="Memory Usage" />
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <HealthMetric
              label="Uptime"
              value={health.server.uptime}
              icon={<Clock className="w-5 h-5" />}
            />
            <HealthMetric
              label="Total Memory"
              value={health.server.totalMem}
              icon={<HardDrive className="w-5 h-5" />}
            />
            <HealthMetric
              label="Free Memory"
              value={health.server.freeMem}
              icon={<HardDrive className="w-5 h-5" />}
            />
            <HealthMetric
              label="Node.js"
              value={health.server.nodeVersion}
              icon={<Server className="w-5 h-5" />}
            />
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500">
              Last checked: {new Date(health.timestamp).toLocaleString()} ·
              Platform: {health.server.platform}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
