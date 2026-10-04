/**
 * PM2 — local Windows stack: go2rtc + backend + frontend + AI-Cam.
 *
 *   npm i -g pm2                                  (once)
 *   pm2 start ecosystem.local.config.js
 *   pm2 logs                                       (all logs)
 *   pm2 logs monitoring-backend                    (one service)
 *   pm2 restart monitoring-backend                 (after a code change)
 *   pm2 stop ecosystem.local.config.js             (stop all)
 *   pm2 delete ecosystem.local.config.js           (remove from the list)
 *   pm2 save                                       (persist the list)
 *
 * PostgreSQL is a Windows SERVICE, not an app here — PM2 cannot manage it.
 * Start/stop it separately (needs Administrator):
 *     .\scripts\postgres.ps1 start
 *     .\scripts\postgres.ps1 stop
 *
 * Cameras live in the database (GET /api/ai/runtime-config), so adding a camera
 * never means editing this file, go2rtc.yaml, or any .env.
 *
 * Note: PM2 auto-restarts a crashed process, so the backend recovers by itself
 * from a transient failure.
 */
const path = require('path');

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

/** Shared defaults for every app. */
const base = {
  autorestart: true,
  max_restarts: 10,
  restart_delay: 3000,
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  merge_logs: true,
};

module.exports = {
  apps: [
    {
      ...base,
      name: 'go2rtc',
      cwd: __dirname,
      script: isWin ? 'go2rtc.exe' : './go2rtc',
      interpreter: 'none',
    },
    {
      ...base,
      name: 'monitoring-backend',
      cwd: path.join(__dirname, 'backend'),
      script: npm,
      args: 'run dev',
      interpreter: 'none',
      env: { NODE_ENV: 'development', PORT: '4000' },
    },
    {
      ...base,
      name: 'monitoring-frontend',
      cwd: path.join(__dirname, 'frontend'),
      script: npm,
      args: 'run dev',
      interpreter: 'none',
      env: { NODE_ENV: 'development', PORT: '3000' },
    },
    {
      ...base,
      name: 'aicam',
      cwd: path.join(__dirname, 'ai-cam'),
      script: isWin
        ? path.join(__dirname, 'ai-cam', '.venv', 'Scripts', 'python.exe')
        : 'python3',
      args: 'main.py',
      interpreter: 'none',
      restart_delay: 5000,
    },
  ],
};
