"use client";

import { UserFormDialog } from "@/components/users/UserFormDialog";
import { api } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import { PaginatedResponse, User } from "@/types";
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const roleColors: Record<string, string> = {
  Admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  Manager: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Operator: "bg-green-500/20 text-green-400 border-green-500/30",
  Viewer: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export default function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<User | undefined>();
  const limit = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(search && { search }),
      });
      const res = await api.get<PaginatedResponse<User>>(`/users?${params}`);
      if (res.success) {
        setUsers(res.data);
        setTotal(res.meta.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleDelete = async (id: string) => {
    if (!confirm(t("users.deleteConfirm"))) return;
    try {
      await api.delete(`/users/${id}`);
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("users.deleteFailed"));
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{t("users.title")}</h1>
          <p className="text-gray-400 text-sm mt-1">{t("users.registered", { total })}</p>
        </div>
        <button
          onClick={() => {
            setEditUser(undefined);
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2.5 rounded-lg transition text-sm"
        >
          <Plus className="w-4 h-4" />
          {t("users.addUser")}
        </button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("users.searchPlaceholder")}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <button
          onClick={fetchUsers}
          className="p-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-950/50">
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("users.colUser")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("users.colEmail")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("users.colRole")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("users.colStatus")}
                </th>
                <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("users.colCreated")}
                </th>
                <th className="text-right px-4 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  {t("users.colActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-gray-800 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-500">
                    {t("users.noUsers")}
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-800/40 transition">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-600/30 flex items-center justify-center text-blue-400 text-xs font-bold">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-white">
                          {user.username}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-300">{user.email}</td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium border",
                          roleColors[user.role?.name] ??
                            "bg-gray-500/20 text-gray-400",
                        )}
                      >
                        {user.role?.name}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium border",
                          user.isActive
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-red-500/20 text-red-400 border-red-500/30",
                        )}
                      >
                        {user.isActive ? t("users.active") : t("users.inactive")}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-400 text-xs">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditUser(user);
                            setShowForm(true);
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-400/10 rounded transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-xs text-gray-400">
              {t("common.showingRange", {
                from: (page - 1) * limit + 1,
                to: Math.min(page * limit, total),
                total,
              })}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 transition"
              >
                {t("common.previous")}
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs bg-gray-800 text-gray-300 rounded hover:bg-gray-700 disabled:opacity-40 transition"
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <UserFormDialog
          user={editUser}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            fetchUsers();
          }}
        />
      )}
    </div>
  );
}
