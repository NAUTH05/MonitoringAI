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
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Users,
  Car,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const navItems = [
  { href: "/live", labelKey: "nav.liveView", icon: Monitor },
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/license-plates", labelKey: "nav.licensePlates", icon: Car },
  { href: "/cameras", labelKey: "nav.cameras", icon: Camera },
  { href: "/modules", labelKey: "nav.modules", icon: Cpu },
  { href: "/events", labelKey: "nav.events", icon: AlertTriangle },
  { href: "/users", labelKey: "nav.users", icon: Users },
  { href: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { href: "/health", labelKey: "nav.health", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  // Restore sidebar preferences on mount
  useEffect(() => {
    const savedCollapsed = localStorage.getItem("sidebar_collapsed");
    if (savedCollapsed === "1") setIsCollapsed(true);

    const savedWidth = localStorage.getItem("sidebar_width");
    if (savedWidth) setSidebarWidth(Number(savedWidth));
  }, []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar_collapsed", next ? "1" : "0");
      setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
      return next;
    });
  }, []);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(64, Math.min(380, e.clientX));
      if (newWidth < 120) {
        setIsCollapsed(true);
        localStorage.setItem("sidebar_collapsed", "1");
      } else {
        setIsCollapsed(false);
        localStorage.setItem("sidebar_collapsed", "0");
        setSidebarWidth(newWidth);
        localStorage.setItem("sidebar_width", String(newWidth));
      }
      window.dispatchEvent(new Event("resize"));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      window.dispatchEvent(new Event("resize"));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div
      style={{ width: isCollapsed ? 64 : sidebarWidth }}
      className={cn(
        "bg-neutral-950 border-r border-neutral-800 flex flex-col h-screen relative select-none transition-[width] duration-200 shrink-0",
        isResizing && "transition-none border-blue-600"
      )}
    >
      {/* Header / Logo */}
      <div
        className={cn(
          "px-4 h-16 flex items-center justify-between border-b border-neutral-800 shrink-0",
          isCollapsed && "justify-center px-2"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-neutral-200" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              <h1 className="font-semibold text-neutral-100 text-sm leading-tight truncate">
                Smart Monitoring
              </h1>
              <p className="text-[10px] text-neutral-500 truncate">
                {t("nav.tagline")}
              </p>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <button
            onClick={toggleCollapse}
            className="p-1.5 rounded-md border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition shrink-0"
            title="Thu gọn Sidebar"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          const label = t(item.labelKey);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all group relative",
                isCollapsed && "justify-center px-0 py-2.5",
                isActive
                  ? "bg-blue-600/15 border border-blue-600/40 text-blue-400 font-medium"
                  : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900"
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0",
                  isActive
                    ? "text-blue-400"
                    : "text-neutral-400 group-hover:text-neutral-100"
                )}
              />

              {!isCollapsed && <span className="truncate">{label}</span>}

              {/* Floating Tooltip when Collapsed */}
              {isCollapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1 bg-neutral-900 border border-neutral-700 text-neutral-100 text-xs font-medium rounded-md shadow-2xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                  {label}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer & Expand button */}
      <div
        className={cn(
          "p-3 border-t border-neutral-800 flex items-center justify-between shrink-0",
          isCollapsed && "flex-col gap-2 p-2"
        )}
      >
        {isCollapsed ? (
          <button
            onClick={toggleCollapse}
            className="w-full p-2 rounded-lg border border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition flex justify-center"
            title="Mở rộng Sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        ) : (
          <>
            <span className="text-[11px] font-mono text-neutral-600">
              v1.0.0 MVP
            </span>
            <button
              onClick={toggleCollapse}
              className="p-1 text-neutral-500 hover:text-neutral-300 transition"
              title="Thu gọn"
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Resize Drag Handle on right border */}
      <div
        onMouseDown={startResizing}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 active:bg-blue-600 transition-colors z-20"
        title="Kéo sang trái/phải để chỉnh chiều rộng Sidebar"
      />
    </div>
  );
}
