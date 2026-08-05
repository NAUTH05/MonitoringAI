// PM2 process manager — backend + frontend
// Dùng:  pm2 start ecosystem.config.js  &&  pm2 save  &&  pm2 startup systemd
// go2rtc và PostgreSQL chạy dạng systemd service riêng (xem deploy/DEPLOY_LINUX.md).
module.exports = {
  apps: [
    {
      name: 'monitoring-backend',
      cwd: './backend',
      script: 'dist/index.js',        // cần chạy `npm run build` trước
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        PORT: '4000',
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: 'monitoring-frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'start',                  // next start; cần `npm run build` trước
      interpreter: 'none',            // chạy npm trực tiếp (Linux)
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
}
