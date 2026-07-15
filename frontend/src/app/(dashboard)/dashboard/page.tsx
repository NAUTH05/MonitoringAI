"use client";

import { AlertChart } from "@/components/dashboard/AlertChart";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { TopCameras } from "@/components/dashboard/TopCameras";
import { api } from "@/lib/api";
import { ApiResponse, DashboardStats } from "@/types";
import { AlertTriangle, Camera, TrendingUp, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    try {
      const res =
        await api.get<ApiResponse<DashboardStats>>("/reports/dashboard");
      if (res.success) setStats(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle className="w-10 h-10 text-red-400" />
        <p className="text-red-400">{error}</p>
        <button
          onClick={fetchStats}
          className="text-sm text-blue-400 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">
          Security monitoring overview
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatsCard
          title="Total Cameras"
          value={stats?.totalCameras ?? 0}
          Icon={Camera}
          color="blue"
          subtitle="All registered cameras"
        />
        <StatsCard
          title="Online"
          value={stats?.onlineCameras ?? 0}
          Icon={Wifi}
          color="green"
          subtitle="Currently active"
        />
        <StatsCard
          title="Offline"
          value={stats?.offlineCameras ?? 0}
          Icon={WifiOff}
          color="gray"
          subtitle="Not connected"
        />
        <StatsCard
          title="Today's Alerts"
          value={stats?.todayAlerts ?? 0}
          Icon={AlertTriangle}
          color="red"
          subtitle="High confidence events"
        />
        <StatsCard
          title="Week Alerts"
          value={stats?.weekAlerts ?? 0}
          Icon={TrendingUp}
          color="yellow"
          subtitle="Last 7 days"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <AlertChart data={stats?.dailyStats ?? []} />
        </div>
        <TopCameras data={stats?.topCameras ?? []} />
      </div>
    </div>
  );
}
