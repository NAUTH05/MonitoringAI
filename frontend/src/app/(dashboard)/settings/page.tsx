"use client";

import { AISearchSettingsPanel } from "@/components/settings/AISearchSettingsPanel";
import { TelegramBotsPanel } from "@/components/settings/telegram/TelegramBotsPanel";
import { cn } from "@/lib/utils";
import { Bell, Settings2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type Tab = "ai" | "telegram";

const TABS: Tab[] = ["ai", "telegram"];

function readTabFromUrl(): Tab {
  if (typeof window === "undefined") return "ai";
  const value = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(value as Tab) ? (value as Tab) : "ai";
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("ai");

  // Deep link: /settings?tab=telegram (kept in sync so the URL is shareable).
  useEffect(() => {
    setTab(readTabFromUrl());
    const onPop = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "ai") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const tabs: { key: Tab; label: string; icon: typeof Sparkles }[] = [
    { key: "ai", label: t("aiSearch.settings.tabAi"), icon: Sparkles },
    { key: "telegram", label: t("telegram.title"), icon: Bell },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Settings2 className="w-6 h-6 text-gray-400" />
          {t("aiSearch.settings.title")}
        </h1>
        <p className="text-gray-400 text-sm mt-1">{t("aiSearch.settings.subtitle")}</p>
      </div>

      <div className="flex gap-1 border-b border-gray-800">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => selectTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px transition",
              tab === key
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-400 hover:text-gray-200",
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "ai" ? <AISearchSettingsPanel /> : <TelegramBotsPanel />}
    </div>
  );
}
