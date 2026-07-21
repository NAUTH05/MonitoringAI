"use client";

import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Camera,
  Cpu,
  LayoutDashboard,
  Monitor,
  Radio,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/live", label: "Live View", icon: Monitor },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cameras", label: "Cameras", icon: Camera },
  { href: "/streams", label: "go2rtc Streams", icon: Radio },
  { href: "/modules", label: "AI Modules", icon: Cpu },
  { href: "/events", label: "Event Center", icon: AlertTriangle },
  { href: "/users", label: "Users", icon: Users },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/health", label: "System Health", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-60 bg-neutral-950 border-r border-neutral-800 flex flex-col h-screen">
      {/* Logo */}
      <div className="px-5 h-16 flex items-center border-b border-neutral-800">
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-neutral-300" />
          <div>
            <h1 className="font-medium text-neutral-100 text-sm leading-tight">
              Smart Monitoring
            </h1>
            <p className="text-[11px] text-neutral-500">AI Security System</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900",
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-neutral-800">
        <p className="text-[11px] text-neutral-600 text-center">v1.0.0 MVP</p>
      </div>
    </div>
  );
}
