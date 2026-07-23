"use client";

import { AlertProvider } from "@/components/alerts/AlertProvider";
import { I18nProvider } from "@/components/I18nProvider";
import { LiveWall } from "@/components/live/LiveWall";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  const onLive = pathname === "/live";

  useEffect(() => {
    if (ready && onLive) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [ready, onLive]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <p className="text-gray-400 text-sm">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <AlertProvider>
      <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <Header />
          <main className="flex-1 overflow-auto p-6">
            {/* LiveWall stays mounted across nav changes so camera streams
                never tear down / reconnect. Only visibility toggles. */}
            <div className={onLive ? "h-full" : "hidden h-full"}>
              <LiveWall />
            </div>
            {!onLive && children}
          </main>
        </div>
      </div>
    </AlertProvider>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <I18nProvider>
      <DashboardShell>{children}</DashboardShell>
    </I18nProvider>
  );
}
