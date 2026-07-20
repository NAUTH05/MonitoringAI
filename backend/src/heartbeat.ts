import { Server } from 'socket.io';
import prisma from './lib/prisma';

// Interval to scan cameras (ms) and staleness threshold (ms).
const SCAN_INTERVAL = 30_000;
const OFFLINE_THRESHOLD = 90_000;

/**
 * Watchdog that marks a camera OFFLINE when it stops sending heartbeats.
 * Only touches cameras that have sent at least one heartbeat (lastHeartbeat != null),
 * so demo/seed cameras without heartbeat keep their manual status.
 */
export function startHeartbeatWatchdog(io: Server): void {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD);
      const stale = await prisma.camera.findMany({
        where: {
          status: 'ONLINE',
          lastHeartbeat: { not: null, lt: cutoff },
        },
        select: { id: true },
      });

      for (const cam of stale) {
        const updated = await prisma.camera.update({
          where: { id: cam.id },
          data: { status: 'OFFLINE' },
        });
        io.emit('camera-status', {
          id: updated.id,
          status: updated.status,
          lastHeartbeat: updated.lastHeartbeat,
        });
      }
    } catch (err) {
      console.error('Heartbeat watchdog error:', err);
    }
  }, SCAN_INTERVAL);

  console.log('Heartbeat watchdog started');
}
