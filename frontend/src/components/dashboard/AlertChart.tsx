"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";

interface DailyData {
  date: string;
  count: number;
}

export function AlertChart({ data }: { data: DailyData[] }) {
  const { t } = useTranslation();
  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString("vi-VN", {
      month: "short",
      day: "numeric",
    }),
    [t("reports.chartAlerts")]: d.count,
  }));

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-gray-300 mb-5">
        {t("dashboard.alertTrend")}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={chartData}
          margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1f2937"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            stroke="#4b5563"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="#4b5563"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              border: "1px solid #1f2937",
              borderRadius: "8px",
              color: "#f9fafb",
              fontSize: "12px",
            }}
            cursor={{ fill: "rgba(37,99,235,0.1)" }}
          />
          <Bar
            dataKey={t("reports.chartAlerts")}
            fill="#2563eb"
            radius={[4, 4, 0, 0]}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
