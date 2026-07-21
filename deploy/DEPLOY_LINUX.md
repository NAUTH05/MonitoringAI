# Triển khai monitoringAI trên Ubuntu/Debian

Chạy 100% native với **PM2** (backend + frontend), **nginx** cổng 80, **go2rtc** systemd.
PostgreSQL 16 đã có sẵn trên server.

## Kiến trúc

| Thành phần | Cách chạy | Cổng | Public? |
|---|---|---|---|
| PostgreSQL 16 | đã cài sẵn (systemd) | 5432 | Không (nội bộ) |
| go2rtc | binary Linux + systemd | 1984, 8554 | Có (browser truy cập trực tiếp) |
| Backend (Node 20) | PM2 → `node dist/index.js` | 4000 | Không (qua nginx) |
| Frontend (Next.js 15) | PM2 → `next start` | 3000 | Không (qua nginx) |
| nginx | systemd | 80 | Có |

---

## 0. Giá trị CẦN ĐỔI trước khi production

Sửa trong `backend/.env` (các giá trị demo đang commit sẵn):

| Biến | Giá trị demo hiện tại | Cần đổi thành |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `JWT_SECRET` | `smartmonitoring-jwt-secret-2026-change-in-production` | chuỗi ngẫu nhiên mạnh |
| `CAMERA_API_KEY` | `demo-camera-key-change-me` | key thật (client AI dùng header `x-api-key`) |
| `DATABASE_URL` | `...monitoring_pass@localhost:5432...` | đổi mật khẩu DB |
| `FRONTEND_URL` | `http://localhost:3000` | `http://<domain-hoặc-ip>` (hoặc giữ nếu chỉ LAN) |

`GO2RTC_API_URL="http://localhost:1984"` giữ nguyên.
Đổi luôn mật khẩu 3 user seed (`admin@monitoring.com / Admin@123`, ...) sau khi đăng nhập lần đầu.

`frontend/.env.local` đã đặt URL tương đối (`/api`, socket rỗng) — chạy same-origin qua nginx, không cần đổi khi đổi host.

---

## 1. Cài prerequisites

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx ffmpeg
sudo npm i -g pm2
```

- `ffmpeg` bắt buộc: go2rtc dùng để transcode H265→H264 (binary standalone không kèm sẵn).
- **PostgreSQL 16 đã có sẵn** — bỏ qua cài đặt.
- go2rtc binary Linux: tải bản mới nhất từ https://github.com/AlexxIT/go2rtc/releases
  (repo chỉ có `go2rtc.exe` cho Windows). Đặt cạnh `go2rtc.yaml`, `chmod +x go2rtc`.

Giả định thư mục dự án đặt tại `/opt/monitoringAI` (đổi đường dẫn trong các file cấu hình nếu khác).

## 2. Tạo role + database (PostgreSQL đã cài sẵn)

```bash
sudo -u postgres psql <<'SQL'
CREATE USER monitoring WITH PASSWORD 'ĐỔI_MẬT_KHẨU';
CREATE DATABASE smart_monitoring OWNER monitoring;
SQL
```

Mật khẩu phải khớp `DATABASE_URL` trong `backend/.env`.

## 3. Build + seed backend

```bash
cd /opt/monitoringAI/backend
npm ci
npx prisma generate
npm run db:push        # áp schema (dự án dùng prisma db push, không có migrations)
npm run db:seed        # dữ liệu demo — BỎ QUA nếu đã restore DB thật
npm run build          # tsc -> dist/
```

Đảm bảo `backend/evidence/` ghi được (backend tự tạo lúc khởi động).

## 4. Build frontend

```bash
cd /opt/monitoringAI/frontend
npm ci
npm run build          # NEXT_PUBLIC_* trong .env.local được nhúng lúc build
```

## 5. nginx (cổng 80)

```bash
sudo cp /opt/monitoringAI/nginx/monitoring.conf /etc/nginx/sites-available/monitoring
sudo ln -s /etc/nginx/sites-available/monitoring /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

nginx proxy `/api/`, `/evidence/`, `/socket.io/` → backend; `/` → frontend.
go2rtc (1984) KHÔNG qua nginx — browser gọi trực tiếp.

## 6. go2rtc (systemd)

```bash
sudo cp /opt/monitoringAI/deploy/go2rtc.service /etc/systemd/system/go2rtc.service
# Sửa User/WorkingDirectory/ExecStart trong file cho khớp đường dẫn thật, rồi:
sudo systemctl daemon-reload
sudo systemctl enable --now go2rtc
```

User chạy go2rtc phải GHI được `go2rtc.yaml` (UI ghi thay đổi stream ngược lại file này).

## 7. PM2 (backend + frontend, tự khởi động sau reboot)

```bash
cd /opt/monitoringAI
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd    # chạy đúng lệnh `sudo env PATH=... pm2 startup ...` mà nó in ra
```

## 8. Firewall

```bash
sudo ufw allow 80/tcp      # web
sudo ufw allow 1984/tcp    # go2rtc HLS/WebRTC
sudo ufw allow 8554/tcp    # RTSP re-stream (tùy chọn)
```

Không mở 4000/3000/5432 ra ngoài.

---

## Kiểm thử end-to-end

1. `systemctl status postgresql go2rtc nginx` → active; `pm2 status` → cả 2 app `online`.
2. `curl http://localhost:4000/api/docs` và `curl http://localhost:1984/` → OK.
3. Máy client LAN: mở `http://<server-ip>/` → đăng nhập `admin@monitoring.com / Admin@123`.
4. Dashboard nhận Socket.IO (Network tab: `/socket.io/` 101 Switching Protocols).
5. Camera có stream `.m3u8` → HLS phát được (browser gọi go2rtc `:1984`).
6. Thêm/xóa stream trong UI → `go2rtc.yaml` được ghi lại (kiểm tra quyền ghi).
7. Event có evidence → ảnh/video `/evidence/...` hiển thị qua nginx.
8. Reboot → PostgreSQL, go2rtc, nginx, PM2 (backend+frontend) tự chạy lại.

## Lệnh vận hành

```bash
pm2 logs monitoring-backend        # xem log
pm2 restart monitoring-backend     # restart sau khi build lại
sudo journalctl -u go2rtc -f       # log go2rtc
```
