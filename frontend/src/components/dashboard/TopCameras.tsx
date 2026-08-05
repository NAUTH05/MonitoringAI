"use client";

import { useTranslation } from "react-i18next";

interface TopCamera {
  cameraId: string;
  cameraName: string;
  count: number;
}

export function TopCameras({ data }: { data: TopCamera[] }) {
  const { t } = useTranslation();
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h3 className="text-sm font-semibold text-gray-300 mb-5">
        {t("dashboard.topCameras")}
      </h3>
      {data.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-6">
          {t("dashboard.noData")}
        </p>
      ) : (
        <div className="space-y-4">
          {data.map((cam, idx) => (
            <div key={cam.cameraId} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-4">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between mb-1">
                  <span className="text-sm text-white truncate">
                    {cam.cameraName}
                  </span>
                  <span className="text-sm font-semibold text-blue-400 ml-2">
                    {cam.count}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-500"
                    style={{ width: `${(cam.count / max) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
