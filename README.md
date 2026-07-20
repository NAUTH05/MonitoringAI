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
| Infra | Docker Compose, Nginx |

## Tính năng chính

- Dashboard realtime, quản lý camera, AI modules, events và reports.
- Quản lý stream go2rtc bằng UI (tab **go2rtc Streams**): thêm/sửa/xoá link RTSP trực tiếp trên web, không cần sửa tay file `go2rtc.yaml`. Thao tác đi qua backend proxy có xác thực JWT (xem/thêm/sửa: Admin & Manager, xoá: Admin).

## Yêu cầu

- Docker + Docker Compose

## Cài đặt nhanh (Docker)

**Bước 1 — Tải source về**

```bash
git clone https://github.com/NAUTH05/MonitoringAI.git
cd MonitoringAI
```

**Bước 2 — Tạo 4 file cấu hình từ mẫu**

```bash
cp .env.example .env                                 # cấu hình chung + SERVER_HOST
cp backend/.env.example backend/.env                 # DB, JWT secret của backend
cp frontend/.env.local.example frontend/.env.local   # API URL của frontend
cp go2rtc.yaml.example go2rtc.yaml                    # file stream, để trống được
```

Riêng `go2rtc.yaml`: **không bắt buộc điền RTSP URL bằng tay**. Cứ để nguyên file mẫu, sau khi hệ thống chạy bạn thêm/sửa link camera trực tiếp trong tab **go2rtc Streams** trên web.

**Bước 3 — Đặt IP máy chủ**

Mở `.env`, sửa `SERVER_HOST` thành IP nội bộ của máy đang chạy Docker (ví dụ `192.168.1.100`), không kèm `http://`.

**Bước 4 — Khởi động toàn bộ dịch vụ**

```bash
docker compose up -d
```

**Bước 5 — Nạp dữ liệu ban đầu (chỉ chạy 1 lần)**

```bash
docker compose exec backend npm run db:seed
```

Truy cập `http://<SERVER_HOST>`, đăng nhập, rồi vào tab **go2rtc Streams** để thêm link RTSP của NVR/camera.

## Triển khai lên server nội bộ doanh nghiệp

Hướng dẫn đầy đủ cho server Linux (Ubuntu/Debian 22.04+) hoặc Windows Server có Docker.

### Bước 1 — Chuẩn bị server

Yêu cầu tối thiểu: 2 vCPU, 4 GB RAM, 40 GB disk (nhiều hơn nếu lưu ảnh events/nhiều camera transcode H265).

Cài Docker Engine + Compose plugin (Ubuntu):

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # đăng nhập lại để áp dụng
docker compose version          # xác nhận có Compose v2
```

### Bước 2 — Lấy source

```bash
git clone https://github.com/NAUTH05/MonitoringAI.git
cd MonitoringAI
```

### Bước 3 — Tạo file cấu hình

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
cp go2rtc.yaml.example go2rtc.yaml
```

Sửa các giá trị bắt buộc:

`.env` (dùng khi build frontend + compose):
```
SERVER_HOST=192.168.1.100        # IP nội bộ (hoặc domain) của server, KHÔNG kèm http://
```

`backend/.env` — đổi toàn bộ secret trước khi lên production:
```
DATABASE_URL="postgresql://monitoring:monitoring_pass@postgres:5432/smart_monitoring"
JWT_SECRET="<chuỗi-ngẫu-nhiên-dài, ví dụ: openssl rand -hex 32>"
CAMERA_API_KEY="<key-riêng-cho-camera-AI>"
FRONTEND_URL="http://192.168.1.100"
NODE_ENV="production"
GO2RTC_API_URL="http://go2rtc:1984"   # để nguyên, đây là địa chỉ nội bộ giữa các container
```

Lưu ý bảo mật: đổi luôn `POSTGRES_PASSWORD` trong `docker-compose.yml` và `DATABASE_URL` tương ứng nếu server truy cập được từ mạng rộng.

### Bước 4 — Cấu hình stream ban đầu (tuỳ chọn)

Điền RTSP của NVR vào `go2rtc.yaml` (xem mục "Cấu hình go2rtc" bên dưới). Có thể để trống và thêm sau bằng tab **go2rtc Streams** trên web. File này được mount read-write nên thay đổi từ UI sẽ ghi vĩnh viễn vào file, sống sót qua restart container.

### Bước 5 — Build và khởi động

```bash
docker compose build          # build image backend + frontend
docker compose up -d          # chạy nền toàn bộ stack
docker compose ps             # kiểm tra tất cả service Up
```

`SERVER_HOST` được nhúng vào frontend lúc build (biến `NEXT_PUBLIC_*`). Nếu sau này đổi IP server, phải build lại frontend: `docker compose build frontend && docker compose up -d frontend`.

### Bước 6 — Khởi tạo database (chạy 1 lần)

```bash
docker compose exec backend npm run db:push    # tạo schema
docker compose exec backend npm run db:seed    # tạo user/dữ liệu mẫu
```

### Bước 7 — Truy cập

Mở `http://<SERVER_HOST>` (port 80 qua Nginx). Đăng nhập bằng tài khoản seed, đổi mật khẩu ngay.

### Mở port trên firewall nội bộ

| Port | Dịch vụ | Bắt buộc |
|---|---|---|
| 80 | Web UI (Nginx) | Có |
| 1984 | go2rtc HLS — browser lấy stream trực tiếp | Có (cho máy client xem camera) |
| 8554 | RTSP re-stream | Tuỳ chọn |
| 5432 | PostgreSQL | Không (chỉ mở nếu cần truy cập DB từ ngoài) |

Ví dụ (ufw):
```bash
sudo ufw allow 80/tcp
sudo ufw allow 1984/tcp
```

### Vận hành

```bash
docker compose logs -f backend        # xem log
docker compose restart backend        # restart 1 service
docker compose down                   # dừng (giữ dữ liệu DB trong volume)
docker compose pull && docker compose up -d   # cập nhật image bên thứ 3
```

Cập nhật code mới:
```bash
git pull
docker compose build backend frontend
docker compose up -d
```

Sao lưu database:
```bash
docker compose exec postgres pg_dump -U monitoring smart_monitoring > backup_$(date +%F).sql
```

## Cài đặt local (dev)

```bash
# Khởi động postgres + go2rtc
docker compose up postgres go2rtc -d

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
