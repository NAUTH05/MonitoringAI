"use client";

import { EventDetailDialog } from "@/components/events/EventDetailDialog";
import { api } from "@/lib/api";
import { ApiResponse, Event } from "@/types";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * ONE global event-detail mechanism.
 *
 * `EventDetailDialog` is mounted exactly once (here, at the dashboard layout
 * level). Every surface that can reveal an event — the realtime alert toast,
 * the header bell dropdown, the events page "View" action and the per-camera
 * alert overlay — calls `openEvent(...)` from this context, so the dialog opens
 * on the CURRENT page. Nothing routes the user to /events first.
 */

interface EventDetailContextValue {
  /** Open the detail dialog for an Event object, or fetch it by id first. */
  openEvent: (eventOrId: Event | string, alertId?: string) => void;
  closeEvent: () => void;
}

const EventDetailContext = createContext<EventDetailContextValue | null>(null);

export function useEventDetail(): EventDetailContextValue {
  const ctx = useContext(EventDetailContext);
  if (!ctx) {
    throw new Error("useEventDetail must be used within <EventDetailProvider>");
  }
  return ctx;
}

export function EventDetailProvider({ children }: { children: React.ReactNode }) {
  const [event, setEvent] = useState<Event | null>(null);

  // Opening a notification marks its alert READ (fire-and-forget; never blocks
  // the dialog and never surfaces an error to the user).
  const markRead = useCallback(async (alertId?: string) => {
    if (!alertId) return;
    try {
      await api.patch(`/events/alerts/${alertId}/read`);
    } catch {
      /* non-fatal */
    }
  }, []);

  const openEvent = useCallback(
    (eventOrId: Event | string, alertId?: string) => {
      if (typeof eventOrId === "string") {
        void (async () => {
          try {
            const res = await api.get<ApiResponse<Event>>(`/events/${eventOrId}`);
            if (res.success && res.data) {
              setEvent(res.data);
              void markRead(alertId ?? res.data.alert?.id);
            }
          } catch {
            /* non-fatal: keep whatever is on screen */
          }
        })();
        return;
      }
      setEvent(eventOrId);
      void markRead(alertId ?? eventOrId.alert?.id);
    },
    [markRead],
  );

  const closeEvent = useCallback(() => setEvent(null), []);

  const value = useMemo(
    () => ({ openEvent, closeEvent }),
    [openEvent, closeEvent],
  );

  return (
    <EventDetailContext.Provider value={value}>
      {children}
      {event && <EventDetailDialog event={event} onClose={closeEvent} />}
    </EventDetailContext.Provider>
  );
}
