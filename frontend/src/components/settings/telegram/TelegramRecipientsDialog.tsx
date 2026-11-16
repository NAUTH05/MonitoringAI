"use client";

/**
 * Recipient management for one bot.
 *
 * Chat ids are typed manually (the reliable path), with an optional
 * "Discover chats" helper that reads `getUpdates`. Discovery never grants
 * permission on its own — the UI says so and offers a test send per recipient.
 */
import { api } from "@/lib/api";
import { ApiResponse, TelegramBot, TelegramChatDiscovery, TelegramRecipient, TelegramTestResult } from "@/types";
import { Loader2, Plus, RefreshCw, Send, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorBanner,
  Field,
  Modal,
  Toggle,
  inputClass,
  selectClass,
} from "./shared";

interface Props {
  bot: TelegramBot;
  onClose: () => void;
  /** Lets the parent refresh recipient counters after changes. */
  onChanged: () => void;
}

const CHAT_TYPES = ["", "private", "group", "supergroup", "channel"] as const;

export function TelegramRecipientsDialog({ bot, onClose, onChanged }: Props) {
  const { t } = useTranslation();

  const [recipients, setRecipients] = useState<TelegramRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [chatId, setChatId] = useState("");
  const [name, setName] = useState("");
  const [chatType, setChatType] = useState<string>("");
  const [adding, setAdding] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TelegramRecipient | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<TelegramChatDiscovery[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ApiResponse<TelegramRecipient[]>>(`/telegram/bots/${bot.id}/recipients`);
      if (res.success) setRecipients(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.loadRecipientsFailed"));
    } finally {
      setLoading(false);
    }
  }, [bot.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const addRecipient = async (payload: { chatId: string; name: string; chatType?: string | null }) => {
    const res = await api.post<ApiResponse<TelegramRecipient>>(
      `/telegram/bots/${bot.id}/recipients`,
      { chatId: payload.chatId.trim(), name: payload.name.trim(), chatType: payload.chatType || null },
    );
    if (!res.success) throw new Error(res.message ?? t("telegram.saveFailed"));
    return res.data;
  };

  const handleAdd = async () => {
    setError(null);
    setNotice(null);
    if (!chatId.trim()) {
      setError(t("telegram.chatIdRequired"));
      return;
    }
    if (!name.trim()) {
      setError(t("telegram.recipientNameRequired"));
      return;
    }

    setAdding(true);
    try {
      const created = await addRecipient({ chatId, name, chatType });
      setRecipients((prev) => [...prev, created]);
      setChatId("");
      setName("");
      setChatType("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.saveFailed"));
    } finally {
      setAdding(false);
    }
  };

  const toggleRecipient = async (recipient: TelegramRecipient, next: boolean) => {
    setBusyId(recipient.id);
    setError(null);
    try {
      const res = await api.patch<ApiResponse<TelegramRecipient>>(
        `/telegram/recipients/${recipient.id}`,
        { isEnabled: next },
      );
      setRecipients((prev) => prev.map((r) => (r.id === recipient.id ? res.data : r)));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.saveFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const testRecipient = async (recipient: TelegramRecipient) => {
    setBusyId(recipient.id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<ApiResponse<TelegramTestResult>>(
        `/telegram/recipients/${recipient.id}/test`,
        {},
      );
      if (res.data?.ok) {
        setNotice(t("telegram.testSent", { count: 1 }));
      } else {
        setError(t("telegram.testFailed", { error: res.data?.error ?? res.message ?? "" }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.testFailed", { error: "" }));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/telegram/recipients/${deleting.id}`);
      setRecipients((prev) => prev.filter((r) => r.id !== deleting.id));
      setDeleting(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.deleteFailed"));
    } finally {
      setDeleteBusy(false);
    }
  };

  const discover = async () => {
    setDiscovering(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.get<ApiResponse<TelegramChatDiscovery[]>>(`/telegram/bots/${bot.id}/updates`);
      if (res.success) setDiscovered(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.loadRecipientsFailed"));
    } finally {
      setDiscovering(false);
    }
  };

  const useDiscovered = async (chat: TelegramChatDiscovery) => {
    setError(null);
    setNotice(null);
    try {
      const created = await addRecipient({
        chatId: chat.chatId,
        name: chat.title || chat.chatId,
        chatType: chat.chatType,
      });
      setRecipients((prev) => [...prev, created]);
      setDiscovered((prev) => prev?.map((c) => (c.chatId === chat.chatId ? { ...c, saved: true } : c)) ?? null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("telegram.saveFailed"));
    }
  };

  return (
    <Modal
      title={t("telegram.recipientsTitle", { name: bot.name })}
      subtitle={t("telegram.recipientsHint")}
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="space-y-5">
        {error && <ErrorBanner message={error} />}
        {notice && (
          <div className="bg-emerald-900/20 border border-emerald-800 text-emerald-300 rounded-lg px-3 py-2.5 text-sm">
            {notice}
          </div>
        )}

        {/* Add form */}
        <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr_auto] items-end">
          <Field label={t("telegram.chatId")} hint={t("telegram.chatIdHint")}>
            <input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder={t("telegram.chatIdPlaceholder")}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label={t("telegram.recipientName")}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("telegram.recipientNamePlaceholder")}
              className={inputClass}
            />
          </Field>
          <div className="flex gap-2">
            <select
              value={chatType}
              onChange={(e) => setChatType(e.target.value)}
              aria-label={t("telegram.chatType")}
              className={selectClass}
            >
              {CHAT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type ? type : t("telegram.chatTypeUnknown")}
                </option>
              ))}
            </select>
            <Button variant="primary" onClick={handleAdd} loading={adding}>
              <Plus className="w-3.5 h-3.5" />
              {t("telegram.addRecipient")}
            </Button>
          </div>
        </div>

        {/* Recipient list */}
        <div className="border border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-6 flex items-center justify-center text-gray-500 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : recipients.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              <Users className="w-5 h-5 mx-auto mb-2 text-gray-600" />
              {t("telegram.recipientsEmpty")}
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {recipients.map((recipient) => (
                <li key={recipient.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-white truncate">{recipient.name}</p>
                      {recipient.chatType && <Badge>{recipient.chatType}</Badge>}
                      {!recipient.isEnabled && <Badge tone="gray">{t("telegram.disabled")}</Badge>}
                    </div>
                    <p className="text-[11px] font-mono text-gray-500 mt-0.5">{recipient.chatId}</p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => testRecipient(recipient)}
                      loading={busyId === recipient.id}
                      title={t("telegram.sendTest")}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                    <Toggle
                      checked={recipient.isEnabled}
                      onChange={(next) => toggleRecipient(recipient, next)}
                      disabled={busyId === recipient.id}
                      label={t("telegram.enabled")}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleting(recipient)}
                      title={t("telegram.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Discovery helper */}
        <div className="border border-gray-800 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[11px] text-gray-500 leading-relaxed">{t("telegram.discoverHint")}</p>
            <Button size="sm" onClick={discover} loading={discovering}>
              <RefreshCw className="w-3.5 h-3.5" />
              {discovering ? t("telegram.discovering") : t("telegram.discover")}
            </Button>
          </div>

          {discovered && discovered.length === 0 && (
            <p className="text-xs text-gray-500">{t("telegram.discoverEmpty")}</p>
          )}

          {discovered && discovered.length > 0 && (
            <ul className="divide-y divide-gray-800 border-t border-gray-800">
              {discovered.map((chat) => (
                <li key={chat.chatId} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-200 truncate">{chat.title}</p>
                    <p className="text-[11px] font-mono text-gray-500">
                      {chat.chatId} · {chat.chatType}
                    </p>
                  </div>
                  {chat.saved ? (
                    <Badge tone="green">{t("telegram.discoverSaved")}</Badge>
                  ) : (
                    <Button size="sm" onClick={() => useDiscovered(chat)}>
                      {t("telegram.discoverAdd")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title={t("telegram.deleteRecipientConfirm")}
          message={`${deleting.name} · ${deleting.chatId}`}
          confirmLabel={t("telegram.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
          loading={deleteBusy}
        />
      )}
    </Modal>
  );
}
