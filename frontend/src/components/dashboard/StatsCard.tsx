import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

type Color = "blue" | "green" | "red" | "yellow" | "purple" | "gray";

interface StatsCardProps {
  title: string;
  value: number | string;
  Icon: LucideIcon;
  color?: Color;
  subtitle?: string;
}

const colorMap: Record<Color, { bg: string; icon: string; border: string }> = {
  blue: {
    bg: "bg-blue-500/10",
    icon: "text-blue-400",
    border: "border-blue-500/20",
  },
  green: {
    bg: "bg-green-500/10",
    icon: "text-green-400",
    border: "border-green-500/20",
  },
  red: {
    bg: "bg-red-500/10",
    icon: "text-red-400",
    border: "border-red-500/20",
  },
  yellow: {
    bg: "bg-yellow-500/10",
    icon: "text-yellow-400",
    border: "border-yellow-500/20",
  },
  purple: {
    bg: "bg-purple-500/10",
    icon: "text-purple-400",
    border: "border-purple-500/20",
  },
  gray: {
    bg: "bg-gray-500/10",
    icon: "text-gray-400",
    border: "border-gray-500/20",
  },
};

export function StatsCard({
  title,
  value,
  Icon,
  color = "blue",
  subtitle,
}: StatsCardProps) {
  const c = colorMap[color];
  return (
    <div className={cn("bg-gray-900 border rounded-xl p-6", c.border)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{title}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center",
            c.bg,
          )}
        >
          <Icon className={cn("w-6 h-6", c.icon)} />
        </div>
      </div>
    </div>
  );
}
