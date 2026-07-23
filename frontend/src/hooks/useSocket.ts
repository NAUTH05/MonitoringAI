'use client';

import { connectSocket, getSocket } from '@/lib/socket';
import { Alert, CameraStatus, Event } from '@/types';
import { useEffect } from 'react';
import { Layouts } from 'react-grid-layout';

type AlertCallback = (alert: Alert & { event: Event }) => void;
type EventCallback = (event: Event) => void;
type CameraStatusCallback = (payload: { id: string; status: CameraStatus; lastHeartbeat?: string }) => void;
type LayoutUpdatedCallback = (payload: { layout: Layouts; uniform: boolean }) => void;

export function useSocket(
  onNewAlert?: AlertCallback,
  onNewEvent?: EventCallback,
  onCameraStatus?: CameraStatusCallback,
  onLayoutUpdated?: LayoutUpdatedCallback,
) {
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    connectSocket();
    const socket = getSocket();

    if (onNewAlert) socket.on('new-alert', onNewAlert);
    if (onNewEvent) socket.on('new-event', onNewEvent);
    if (onCameraStatus) socket.on('camera-status', onCameraStatus);
    if (onLayoutUpdated) socket.on('layout-updated', onLayoutUpdated);

    return () => {
      if (onNewAlert) socket.off('new-alert', onNewAlert);
      if (onNewEvent) socket.off('new-event', onNewEvent);
      if (onCameraStatus) socket.off('camera-status', onCameraStatus);
      if (onLayoutUpdated) socket.off('layout-updated', onLayoutUpdated);
    };
  }, [onNewAlert, onNewEvent, onCameraStatus, onLayoutUpdated]);
}
