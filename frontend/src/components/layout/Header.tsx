"use client";

import { useAuth } from "@/hooks/useAuth";
import { Bell, LogOut, User } from "lucide-react";

interface HeaderProps {
  alertCount?: number;
}

export function Header({ alertCount = 0 }: HeaderProps) {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
      <div className="text-sm text-gray-400">
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
          <button className="p-2 text-gray-400 hover:text-white transition rounded-lg hover:bg-gray-800">
            <Bell className="w-5 h-5" />
            {alertCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>
        </div>

        {/* User info */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700">
          <div className="w-7 h-7 rounded-full bg-blue-600/20 border border-blue-600/30 flex items-center justify-center">
            <User className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="hidden md:block leading-tight">
            <p className="text-sm font-medium text-white">
              {user?.username ?? "..."}
            </p>
            <p className="text-xs text-gray-400">{user?.role ?? "..."}</p>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          className="p-2 text-gray-400 hover:text-red-400 transition rounded-lg hover:bg-gray-800"
          title="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
