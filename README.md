# Smart Monitoring AI

Hệ thống giám sát camera AI - dark mode dashboard với realtime alerts.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, TypeScript, Tailwind CSS, Shadcn UI |
| Backend | Express.js, TypeScript, Prisma ORM |
| Database | PostgreSQL |
| Realtime | Socket.IO |
| Stream Gateway | go2rtc (RTSP → HLS) |
| Infra | PM2, Nginx, systemd |

## Tính năng chính

- Dashboard realtime, quản lý camera, AI modules, events và reports.
- Quản lý stream go2rtc bằng UI (tab **go2rtc Streams**): thêm/sửa/xoá link RTSP trực tiếp trên web, không cần sửa tay file `go2rtc.yaml`. Thao tác đi qua backend proxy có xác thực JWT (xem/thêm/sửa: Admin & Manager, xoá: Admin).

## Yêu cầu

- Node.js 20 LTS
- PostgreSQL 16
- Nginx
- PM2 (`npm i -g pm2`)
- ffmpeg (go2rtc dùng để transcode H265→H264)
- go2rtc binary ([releases](https://github.com/AlexxIT/go2rtc/releases))

## Cài đặt nhanh

**Bước 1 — Tải source về**

```bash
git clone https://github.com/NAUTH05/MonitoringAI.git
cd MonitoringAI
```

**Bước 2 — Tạo file cấu hình từ mẫu**

```bash
cp backend/.env.example backend/.env                 # DB, JWT secret của backend
cp frontend/.env.local.example frontend/.env.local   # API URL của frontend
cp go2rtc.yaml.example go2rtc.yaml                    # file stream, để trống được
```

Riêng `go2rtc.yaml`: **không bắt buộc điền RTSP URL bằng tay**. Cứ để nguyên file mẫu, sau khi hệ thống chạy bạn thêm/sửa link camera trực tiếp trong tab **go2rtc Streams** trên web.

**Bước 3 — Cài dependencies & build**

```bash
# Backend
cd backend
npm ci
npx prisma generate
npm run db:push        # tạo schema
npm run db:seed        # tạo user/dữ liệu mẫu
npm run build          # tsc -> dist/
cd ..

# Frontend
cd frontend
npm ci
npm run build
cd ..
```

**Bước 4 — Cấu hình nginx**

```bash
sudo cp nginx/monitoring.conf /etc/nginx/sites-available/monitoring
sudo ln -s /etc/nginx/sites-available/monitoring /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**Bước 5 — Khởi động go2rtc**

```bash
# Linux: tải binary từ GitHub releases, đặt cạnh go2rtc.yaml
chmod +x go2rtc
# Hoặc dùng systemd service (xem deploy/DEPLOY_LINUX.md)

# Windows: dùng go2rtc.exe có sẵn trong repo
./go2rtc.exe
```

**Bước 6 — Khởi động backend + frontend bằng PM2**

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd    # chạy lệnh sudo mà nó in ra để tự khởi động sau reboot
```

Truy cập `http://<SERVER_IP>`, đăng nhập, rồi vào tab **go2rtc Streams** để thêm link RTSP của NVR/camera.

## Triển khai lên server nội bộ doanh nghiệp

Xem hướng dẫn đầy đủ tại [`deploy/DEPLOY_LINUX.md`](deploy/DEPLOY_LINUX.md) cho server Ubuntu/Debian.

### Yêu cầu tối thiểu

2 vCPU, 4 GB RAM, 40 GB disk (nhiều hơn nếu lưu ảnh events/nhiều camera transcode H265).

### Mở port trên firewall nội bộ

| Port | Dịch vụ | Bắt buộc |
|---|---|---|
| 80 | Web UI (Nginx) | Có |
| 1984 | go2rtc HLS — browser lấy stream trực tiếp | Có (cho máy client xem camera) |
| 8554 | RTSP re-stream | Tuỳ chọn |
| 5432 | PostgreSQL | Không (chỉ mở nếu cần truy cập DB từ ngoài) |

### Vận hành

```bash
pm2 logs monitoring-backend        # xem log
pm2 restart monitoring-backend     # restart 1 service
sudo journalctl -u go2rtc -f       # log go2rtc
```

Cập nhật code mới:
```bash
git pull
cd backend && npm ci && npm run build && cd ..
cd frontend && npm ci && npm run build && cd ..
pm2 restart all
```

Sao lưu database:
```bash
pg_dump -U monitoring smart_monitoring > backup_$(date +%F).sql
```

## Cài đặt local (dev)

```bash
# Cần PostgreSQL đang chạy trên máy (localhost:5432)

# Backend
cd backend
cp .env.example .env   # điền DATABASE_URL, JWT_SECRET, CAMERA_API_KEY
npm install
npm run db:push
npm run db:seed
npm run dev

# Frontend (terminal khác)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev

# go2rtc (terminal khác) — Windows:
./go2rtc.exe
# Linux: tải binary từ GitHub releases
./go2rtc
```

## Cấu hình Camera AI → Push Events

Camera AI gửi `POST /api/events` với header `x-api-key`:

```bash
curl -X POST http://<SERVER>/api/events \
  -H "x-api-key: <CAMERA_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "cameraId": "<uuid>",
    "eventType": "INTRUSION",
    "confidence": 0.92,
    "imageUrl": "http://...",
    "timestamp": "2026-07-15T10:00:00Z"
  }'
```

`eventType`: `INTRUSION` | `FIRE` | `SMOKE` | `PPE` | `FACE` | `VEHICLE`

## Cấu hình go2rtc (RTSP streams)

Sao chép `go2rtc.yaml.example` thành `go2rtc.yaml` và điền URL RTSP:

```yaml
streams:
  nvr_ch1: rtsp://admin:password@192.168.1.200:554/Streaming/Channels/101
  nvr_ch2: rtsp://admin:password@192.168.1.200:554/Streaming/Channels/201
```

Sau đó nhập URL HLS vào phần cấu hình camera trong app:
`http://<SERVER>:1984/api/stream.m3u8?src=nvr_ch1`

### Quản lý stream bằng UI (khuyến nghị)

Vào tab **go2rtc Streams** trên dashboard để thêm/sửa/xoá stream mà không cần sửa file. Thay đổi được ghi vĩnh viễn vào `go2rtc.yaml`.

- Camera H265 (HEVC): browser không decode trực tiếp, nhập nguồn dạng `ffmpeg:rtsp://.../101#video=h264` để transcode sang H264.
- Sub stream H264: nhập thẳng URL RTSP, nhẹ hơn.

Lưu ý: khi go2rtc ghi lại file (lần thay đổi đầu tiên qua UI), nó chuẩn hoá format YAML và có thể xoá comment trong `go2rtc.yaml`. Đổi tên stream = xoá stream cũ rồi tạo mới.

## User Roles

| Role | Quyền |
|---|---|
| Admin | Toàn quyền |
| Manager | Xem + quản lý events/reports |
| Operator | Xem + acknowledge alerts |
| Viewer | Chỉ xem |
