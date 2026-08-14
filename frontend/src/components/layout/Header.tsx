"use client";

import { useAuth } from "@/hooks/useAuth";
import { useSocket } from "@/hooks/useSocket";
import { formatDate } from "@/lib/utils";
import { Alert, Event } from "@/types";
import { AlertTriangle, Bell, Globe, LogOut, User, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

interface HeaderProps {
  alertCount?: number;
}

type AlertPayload = Alert & { event: Event };

export function Header({ alertCount: initialAlertCount = 0 }: HeaderProps) {
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const [currentLang, setCurrentLang] = useState(() => i18n.language || "vi");

  const [alerts, setAlerts] = useState<AlertPayload[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialAlertCount);
  const [showNotifications, setShowNotifications] = useState(false);

  const toggleLanguage = () => {
    const nextLang = currentLang === "vi" ? "en" : "vi";
    i18n.changeLanguage(nextLang);
    setCurrentLang(nextLang);
  };

  const handleNewAlert = useCallback((alertData: AlertPayload) => {
    setAlerts((prev) => [alertData, ...prev.slice(0, 19)]);
    setUnreadCount((count) => count + 1);
  }, []);

  useSocket(handleNewAlert);

  const clearAlerts = () => {
    setAlerts([]);
    setUnreadCount(0);
  };

  return (
    <header className="h-16 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between px-6 flex-shrink-0 z-30">
      <div className="text-sm text-neutral-400 font-medium">
        {new Date().toLocaleDateString(currentLang === "vi" ? "vi-VN" : "en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </div>

      <div className="flex items-center gap-3">
        {/* Language Switcher (EN/VI) */}
        <button
          onClick={toggleLanguage}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-neutral-800 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-200 transition"
          title={t("header.language")}
        >
          <Globe className="w-3.5 h-3.5 text-blue-400" />
          <span className="uppercase">{currentLang}</span>
          <span className="text-[10px] text-neutral-400 font-normal">
            ({currentLang === "vi" ? "VIE" : "ENG"})
          </span>
        </button>

        {/* Alert bell & notification dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications((prev) => !prev)}
            className="relative p-2 text-neutral-400 hover:text-neutral-100 transition rounded-md hover:bg-neutral-900"
            title={t("header.notifications")}
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-[9px] font-bold bg-red-600 text-white rounded-full">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {/* Notification dropdown menu */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-semibold text-neutral-100">
                    {t("header.notifications")}
                  </span>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded-full font-bold">
                      {unreadCount}
                    </span>
                  )}
                </div>
                {alerts.length > 0 && (
                  <button
                    onClick={clearAlerts}
                    className="text-xs text-neutral-400 hover:text-neutral-200 underline"
                  >
                    {t("header.markAllRead")}
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-neutral-800">
                {alerts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-neutral-500">
                    {t("header.noAlerts")}
                  </div>
                ) : (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="p-3 hover:bg-neutral-850 transition flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="mt-0.5 p-1 bg-red-500/10 rounded border border-red-500/30 text-red-400 shrink-0">
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-neutral-200 truncate">
                            {alert.event?.eventType} - {alert.event?.camera?.name || t("alertToast.unknownCamera")}
                          </p>
                          <p className="text-[11px] text-neutral-400 mt-0.5">
                            {alert.event?.camera?.location} · {t("alertToast.confidence")}{" "}
                            {((alert.event?.confidence ?? 0) * 100).toFixed(0)}%
                          </p>
                          <span className="text-[10px] text-neutral-500 block mt-1">
                            {alert.event?.timestamp ? formatDate(alert.event.timestamp) : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User info */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-neutral-800">
          <div className="w-7 h-7 rounded-full bg-neutral-800 flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-neutral-300" />
          </div>
          <div className="hidden md:block leading-tight">
            <p className="text-sm text-neutral-100">
              {user?.username ?? "..."}
            </p>
            <p className="text-xs text-neutral-500">{user?.role ?? "..."}</p>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          className="p-2 text-neutral-400 hover:text-red-400 transition rounded-md hover:bg-neutral-900"
          title={t("header.logout")}
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
