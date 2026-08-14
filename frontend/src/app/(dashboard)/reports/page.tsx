"use client";

import { api } from "@/lib/api";
import { ApiResponse } from "@/types";
import { Activity, BarChart2, Clock, Download, PieChart as PieIcon, RefreshCw, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Period = "daily" | "weekly" | "monthly";

interface DailyReport {
  date: string;
  totalEvents: number;
  totalAlerts: number;
  byType: Record<string, number>;
}

interface WeeklyReport {
  startDate: string;
  endDate: string;
  dailyData: { date: string; count: number; alerts: number }[];
  byType: { type: string; count: number }[];
}

const COLORS = [
  "#2563eb",
  "#dc2626",
  "#d97706",
  "#16a34a",
  "#9333ea",
  "#0891b2",
];

export default function ReportsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>("weekly");
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      if (period === "daily") {
        const res = await api.get<ApiResponse<DailyReport>>(
          `/reports/daily?date=${selectedDate}`,
        );
        if (res.success) setDailyReport(res.data);
      } else if (period === "weekly" || period === "monthly") {
        const res = await api.get<ApiResponse<WeeklyReport>>(
          `/reports/${period}`,
        );
        if (res.success) setWeeklyReport(res.data);
      }
    } finally {
      setLoading(false);
    }
  }, [period, selectedDate]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const exportCSV = () => {
    let csvContent = "";
    let filename = "";

    if (period === "daily" && dailyReport) {
      csvContent =
        "Type,Count\n" +
        Object.entries(dailyReport.byType)
          .map(([k, v]) => `${k},${v}`)
          .join("\n");
      filename = `report_daily_${dailyReport.date}.csv`;
    } else if (weeklyReport) {
      csvContent =
        "Date,Events,Alerts\n" +
        weeklyReport.dailyData
          .map((d) => `${d.date},${d.count},${d.alerts}`)
          .join("\n");
      filename = `report_${period}.csv`;
    }

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => window.print();

  const chartData =
    period === "daily" && dailyReport
      ? Object.entries(dailyReport.byType).map(([type, count]) => ({
          type,
          count,
        }))
      : (weeklyReport?.dailyData.map((d) => ({
          date: new Date(d.date).toLocaleDateString("vi-VN", {
            month: "short",
            day: "numeric",
          }),
          [t("reports.chartEvents")]: d.count,
          [t("reports.chartAlerts")]: d.alerts,
        })) ?? []);

  const pieData =
    period === "daily" && dailyReport
      ? Object.entries(dailyReport.byType).map(([name, value]) => ({
          name,
          value,
        }))
      : (weeklyReport?.byType.map((b) => ({ name: b.type, value: b.count })) ??
        []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("reports.title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{t("reports.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 bg-green-700 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-sm transition"
          >
            <Download className="w-4 h-4" />
            {t("reports.exportCsv")}
          </button>
          <button
            onClick={exportPDF}
            className="flex items-center gap-2 bg-red-700 hover:bg-red-600 text-white px-3 py-2 rounded-lg text-sm transition"
          >
            <Download className="w-4 h-4" />
            {t("reports.printPdf")}
          </button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-gray-900 border border-gray-800 rounded-lg p-1">
          {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition capitalize ${
                period === p
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {t(`reports.period.${p}`)}
            </button>
          ))}
        </div>
        {period === "daily" && (
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        )}
        <button
          onClick={fetchReport}
          className="p-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <>
          {/* Summary KPI cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">{t("reports.totalEvents")}</p>
                <p className="text-3xl font-bold text-white mt-1">
                  {period === "daily" ? dailyReport?.totalEvents ?? 0 : weeklyReport?.dailyData.reduce((acc, d) => acc + d.count, 0) ?? 0}
                </p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
                <Activity className="w-6 h-6" />
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">{t("reports.totalAlerts")}</p>
                <p className="text-3xl font-bold text-red-400 mt-1">
                  {period === "daily" ? dailyReport?.totalAlerts ?? 0 : weeklyReport?.dailyData.reduce((acc, d) => acc + d.alerts, 0) ?? 0}
                </p>
              </div>
              <div className="p-3 bg-red-500/10 rounded-xl text-red-400 border border-red-500/20">
                <TrendingUp className="w-6 h-6" />
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-xs font-medium uppercase tracking-wider">{t("reports.alertRate")}</p>
                <p className="text-3xl font-bold text-yellow-400 mt-1">
                  {(() => {
                    const totalEv = period === "daily" ? dailyReport?.totalEvents ?? 0 : weeklyReport?.dailyData.reduce((acc, d) => acc + d.count, 0) ?? 0;
                    const totalAl = period === "daily" ? dailyReport?.totalAlerts ?? 0 : weeklyReport?.dailyData.reduce((acc, d) => acc + d.alerts, 0) ?? 0;
                    return totalEv > 0 ? `${((totalAl / totalEv) * 100).toFixed(0)}%` : "0%";
                  })()}
                </p>
              </div>
              <div className="p-3 bg-yellow-500/10 rounded-xl text-yellow-400 border border-yellow-500/20">
                <Clock className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-gray-300 mb-5 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-400" />
                {period === "daily" ? t("reports.eventsByType") : t("reports.eventsOverTime")}
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                {period === "daily" ? (
                  <BarChart data={chartData as { type: string; count: number }[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="type" stroke="#4b5563" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#4b5563" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111827",
                        border: "1px solid #1f2937",
                        borderRadius: "8px",
                        color: "#f9fafb",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                ) : (
                  <AreaChart data={chartData as { date: string; [key: string]: string | number }[]}>
                    <defs>
                      <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorAlerts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#dc2626" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="date" stroke="#4b5563" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#4b5563" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111827",
                        border: "1px solid #1f2937",
                        borderRadius: "8px",
                        color: "#f9fafb",
                        fontSize: "12px",
                      }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey={t("reports.chartEvents")} stroke="#2563eb" fillOpacity={1} fill="url(#colorEvents)" />
                    <Area type="monotone" dataKey={t("reports.chartAlerts")} stroke="#dc2626" fillOpacity={1} fill="url(#colorAlerts)" />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-gray-300 mb-5 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-purple-400" />
                {t("reports.byEventType")}
              </h3>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={75}
                      dataKey="value"
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                      fontSize={10}
                    >
                      {pieData.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111827",
                        border: "1px solid #1f2937",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray-500 text-sm text-center py-12">
                  {t("reports.noData")}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
