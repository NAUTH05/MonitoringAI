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

## Yêu cầu

- Docker + Docker Compose

## Cài đặt nhanh (Docker)

```bash
# 1. Clone repo
git clone https://github.com/NAUTH05/MonitoringAI.git
cd MonitoringAI

# 2. Copy và điền config
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
cp go2rtc.yaml.example go2rtc.yaml   # điền RTSP URL của NVR/camera

# 3. Chỉnh SERVER_HOST trong .env (IP máy chủ)

# 4. Khởi động
docker compose up -d

# 5. Seed dữ liệu ban đầu (chạy 1 lần)
docker compose exec backend npm run db:seed
```

Truy cập: `http://<SERVER_HOST>`

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

## User Roles

| Role | Quyền |
|---|---|
| Admin | Toàn quyền |
| Manager | Xem + quản lý events/reports |
| Operator | Xem + acknowledge alerts |
| Viewer | Chỉ xem |
