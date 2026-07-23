"use client";

import { useAuth } from "@/hooks/useAuth";
import { Bell, LogOut, User } from "lucide-react";
import { useTranslation } from "react-i18next";

interface HeaderProps {
  alertCount?: number;
}

export function Header({ alertCount = 0 }: HeaderProps) {
  const { user, logout } = useAuth();
  const { t } = useTranslation();

  return (
    <header className="h-16 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between px-6 flex-shrink-0">
      <div className="text-sm text-neutral-500">
        {new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </div>

      <div className="flex items-center gap-3">
        {/* Alert bell */}
        <div className="relative">
          <button className="p-2 text-neutral-400 hover:text-neutral-100 transition rounded-md hover:bg-neutral-900">
            <Bell className="w-5 h-5" />
            {alertCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>
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
