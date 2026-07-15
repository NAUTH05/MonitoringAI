'use client';

import { connectSocket, getSocket } from '@/lib/socket';
import { Alert, CameraStatus, Event } from '@/types';
import { useEffect } from 'react';

type AlertCallback = (alert: Alert & { event: Event }) => void;
type EventCallback = (event: Event) => void;
type CameraStatusCallback = (payload: { id: string; status: CameraStatus; lastHeartbeat?: string }) => void;

export function useSocket(
  onNewAlert?: AlertCallback,
  onNewEvent?: EventCallback,
  onCameraStatus?: CameraStatusCallback,
) {
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    connectSocket();
    const socket = getSocket();

    if (onNewAlert) socket.on('new-alert', onNewAlert);
    if (onNewEvent) socket.on('new-event', onNewEvent);
    if (onCameraStatus) socket.on('camera-status', onCameraStatus);

    return () => {
      if (onNewAlert) socket.off('new-alert', onNewAlert);
      if (onNewEvent) socket.off('new-event', onNewEvent);
      if (onCameraStatus) socket.off('camera-status', onCameraStatus);
    };
  }, [onNewAlert, onNewEvent, onCameraStatus]);
}
