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

## Windows Local PostgreSQL Setup

Hướng dẫn khởi tạo PostgreSQL **cục bộ** cho MonitoringAI trên Windows 11. Quy
trình này **không bao giờ** xoá database/role/dữ liệu đang có — chạy lại nhiều
lần vẫn an toàn (idempotent).

> **Hai database tách biệt (giữ nguyên thiết kế):**
> - `DATABASE_URL` → `smart_monitoring` — dữ liệu ứng dụng (user, camera, module,
>   event, alert, report...).
> - `AICAM_DATABASE_URL` → `aicam` — dòng sự kiện AI (biển số + intrusion).
>
> Đây là chủ đích trong code hiện tại. **Không** gộp hai DB làm một.

### 1. Yêu cầu

- PostgreSQL 16 đã cài, service đang chạy.
- `psql` trên `PATH`, hoặc ở `C:\Program Files\PostgreSQL\16\bin\psql.exe`.
- Node.js 20 + npm (Prisma CLI chạy qua `npx`).
- Biết mật khẩu superuser (`postgres`) — **không** ghi vào file nào trong repo.

### 2. Kiểm tra cài đặt

```powershell
psql --version                              # PostgreSQL 16.x
Get-Service postgresql*                     # service phải "Running"
Test-NetConnection 127.0.0.1 -Port 5432     # TcpTestSucceeded : True
```

Nếu `psql` không có trên PATH:

```powershell
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
```

### 3. Tạo file cấu hình từ mẫu

```powershell
cd C:\Work\PROJECTS\monitoringAI
Copy-Item backend\.env.example backend\.env
Copy-Item ai-cam\.env.example  ai-cam\.env
```

`backend\.env` và `ai-cam\.env` đã được `.gitignore` — **không commit**.

### 4. Biến database (chỉ khai báo trong .env, không hardcode)

`backend\.env`:

```ini
DATABASE_URL="postgresql://monitoring:monitoring_pass@localhost:5432/smart_monitoring"
AICAM_DATABASE_URL="postgresql://monitoring:monitoring_pass@localhost:5432/aicam"
AICAM_EVENTS_DIR="../ai-cam/data/events"
CAMERA_API_KEY="demo-camera-key-change-me"
```

`ai-cam\.env` (chỉ cần khi AI-Cam ghi thẳng vào DB AI — mặc định đã bật):

```ini
AICAM_DATABASE_URL=postgresql://monitoring:monitoring_pass@localhost:5432/aicam
AI_CAM_DB_ENABLED=true
```

`monitoring:monitoring_pass` chỉ là **mặc định dev**. Production phải đổi mật khẩu.

### 5. Chạy script bootstrap (khuyến nghị)

Script idempotent: kiểm tra `psql` → tạo role `monitoring` nếu thiếu → tạo
database nếu thiếu → `prisma generate` + `db push` → (tuỳ chọn) seed → áp schema
AI-Cam → in bảng sức khoẻ. **Không bao giờ DROP.**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-postgres.ps1 -Seed -LinkDevCamera
```

- `-Seed` — tạo user/module/camera mẫu (gồm module **INTRUSION**).
- `-LinkDevCamera` — tạo camera "Laptop Webcam" + gán module INTRUSION.
- Bỏ hai cờ trên nếu chỉ muốn tạo schema rỗng.
- Mật khẩu superuser: script hỏi, hoặc đọc `$env:PGPASSWORD`, **không ghi ra đĩa**.

### 6. Tạo database thủ công (nếu không dùng script)

```powershell
psql -U postgres -h 127.0.0.1 -p 5432 -d postgres
```

```sql
-- trong psql:
CREATE ROLE monitoring LOGIN PASSWORD 'monitoring_pass';
CREATE DATABASE smart_monitoring OWNER monitoring;
CREATE DATABASE aicam            OWNER monitoring;
\q
```

Áp schema AI-Cam (bảng `events`, `streams`):

```powershell
$env:PGPASSWORD="monitoring_pass"
psql -U monitoring -h 127.0.0.1 -p 5432 -d aicam -f ai-cam\sql\aicam_schema.sql
```

### 7. Prisma: generate / push / seed

```powershell
cd backend
npm install
npx prisma generate
npm run db:push      # đồng bộ schema (không xoá dữ liệu)
npm run db:seed      # dữ liệu dev: user, module, camera mẫu
```

`npm run db:seed` là **reseed đầy đủ** (dọn bảng rồi tạo lại) — chỉ dùng cho môi
trường dev. `npm run db:reset` còn mạnh tay hơn; **tránh** trên dữ liệu thật.

### 8. Kiểm tra bằng psql

```powershell
$env:PGPASSWORD="monitoring_pass"
psql -U monitoring -h 127.0.0.1 -p 5432 -d postgres          -c "\l"     # liệt kê DB
psql -U monitoring -h 127.0.0.1 -p 5432 -d smart_monitoring  -c "\dt"     # bảng app
psql -U monitoring -h 127.0.0.1 -p 5432 -d aicam             -c "\dt"     # bảng AI
psql -U monitoring -h 127.0.0.1 -p 5432 -d smart_monitoring  -c "SELECT code FROM ai_modules;"
```

### 9. Khởi động backend

```powershell
cd backend
npm run dev          # http://localhost:4000
```

### 10. Kiểm tra module INTRUSION + lưu bền ROI

ROI được lưu trong `camera_modules.config` (JSON) → **sống sót** qua restart
backend/frontend/AI-Cam. Kiểm tra:

```powershell
psql -U monitoring -h 127.0.0.1 -p 5432 -d smart_monitoring -c `
  "SELECT c.name, m.code, cm.config FROM camera_modules cm
     JOIN cameras c ON c.id = cm.camera_id
     JOIN ai_modules m ON m.id = cm.module_id
    WHERE m.code = 'INTRUSION';"
```

`config` chứa `roiPolygon` dạng `[{"x":..,"y":..}]` đã chuẩn hoá (0..1).

### 11. Reset dữ liệu dev (CẢNH BÁO)

Chỉ chạy khi **chắc chắn** đang trỏ vào DB dev:

```powershell
cd backend
npm run db:reset     # xoá & tạo lại toàn bộ schema dev
```

**Không bao giờ** chạy `db:reset` / `DROP DATABASE` trên môi trường thật.

### 12. Xử lý sự cố

| Lỗi | Cách xử lý |
|---|---|
| `psql: command not found` | Thêm `C:\Program Files\PostgreSQL\16\bin` vào PATH |
| `password authentication failed` | Sai mật khẩu; chạy `ai-cam\scripts\reset_postgres_password.ps1` |
| `database "aicam" does not exist` | Chạy `setup-postgres.ps1` hoặc `ai-cam\scripts\init_aicam_db.ps1` |
| `Can't reach database server` | Service chưa chạy / sai port (`Get-Service postgresql*`) |
| Prisma `P3009` (migration failed) | `npx prisma migrate status`; ở dev có thể dùng `npm run db:push` |
| Trang biển số/intrusion trống | Thiếu `AICAM_DATABASE_URL` + `AICAM_EVENTS_DIR` |
| Ảnh 404 trong UI | `AICAM_EVENTS_DIR` phải trùng `AI_CAM_STORAGE_DIR` |

### 13. Bảo mật

- Không hardcode mật khẩu thật trong source; chỉ để trong `.env` (đã gitignore).
- `backend\.env.example` / `ai-cam\.env.example` chỉ chứa giá trị **mẫu dev**.
- Không mở port 5432 ra Internet; chỉ mở trong mạng nội bộ khi thật cần.
- Đổi `JWT_SECRET` và `CAMERA_API_KEY` trước khi lên production.
- Script bootstrap không in ra mật khẩu.

## Windows Local AI Development

Phần này mô tả cách chạy **AI-Cam cục bộ** trên laptop Windows 11 (GPU NVIDIA
RTX 3050 Laptop 4 GB), dùng **webcam tích hợp** làm nguồn video phát triển và
các model **đã được huấn luyện sẵn** trong `ai-cam/`. Hướng dẫn đầy đủ ở
[`ai-cam/README.md`](ai-cam/README.md).

> **QUAN TRỌNG — phân biệt rõ 3 việc:**
> - **TRAINING**: huấn luyện model — **KHÔNG** thực hiện ở đây. `vehicle_model.pt`,
>   `plate_model.pt`, `trocr_vn_plate_final/` là model đã train, không được sửa.
> - **INFERENCE**: chạy suy luận thời gian thực — `ai-cam/main.py`.
> - **TENSORRT EXPORT**: chuyển `.pt` → `.engine` cho riêng GPU này — chạy thủ
>   công qua `ai-cam/scripts/export_tensorrt.py`, **không** phải training.

### Yêu cầu

- Node.js 20, PostgreSQL 16 (đang chạy local), go2rtc (`go2rtc.exe` có sẵn).
- Python 3.12 trong `ai-cam/.venv`.
- PyTorch CUDA 12.8 + driver NVIDIA (kiểm tra bằng `nvidia-smi`).
- FFmpeg (chỉ cần khi dùng go2rtc để chia sẻ webcam/transcode H265).

### Kiểm tra GPU / PyTorch / model

```powershell
cd ai-cam
.\.venv\Scripts\python.exe scripts\check_gpu.py
.\.venv\Scripts\python.exe scripts\test_models.py
```

`test_models.py` in ra tên lớp đọc trực tiếp từ model (vehicle:
`{0: motorcycle, 1: car, 2: bus, 3: truck}`) và chạy thử OCR.

### Webcam

```powershell
.\.venv\Scripts\python.exe scripts\list_cameras.py   # liệt kê index/thiết bị
```

Không hardcode camera index 0 — cấu hình `WEBCAM_DEVICE` trong `ai-cam/.env`.

### go2rtc (chia sẻ 1 nguồn webcam cho cả MonitoringAI và AI-Cam)

`go2rtc.yaml` đã có stream phát triển `laptop_webcam` (giữ nguyên `AMATA`):

```yaml
streams:
  laptop_webcam:
    - "ffmpeg:device?video=0&resolution=1280x720&framerate=30#video=h264"
```

Chạy `.\go2rtc.exe` (cần FFmpeg trên PATH). AI-Cam khi đó trỏ vào bản restream
`rtsp://127.0.0.1:8554/laptop_webcam`. Nếu **chưa có FFmpeg**, dùng chế độ
webcam trực tiếp của AI-Cam (không bật stream go2rtc) để tránh mở webcam 2 lần.

### AI-Cam: cài đặt & chạy

```powershell
cd ai-cam
Copy-Item .env.example .env
.\scripts\init_aicam_db.ps1          # tạo database aicam (cần mật khẩu postgres)
.\scripts\link_monitoring_camera.ps1 # tạo camera "Laptop Webcam" trong MonitoringAI
.\scripts\run.ps1                    # chạy inference
```

Preview chẩn đoán (chạy được cả khi không có go2rtc/FFmpeg):
`http://127.0.0.1:8090/` — status JSON tại `/status`, ảnh tại `/preview.jpg`.

### Chạy toàn hệ thống (demo)

| Terminal | Lệnh |
|---|---|
| 1 | `.\go2rtc.exe` |
| 2 | `cd backend; npm run dev` |
| 3 | `cd frontend; npm run dev` |
| 4 | `cd ai-cam; .\scripts\run.ps1` |

Hoặc dùng `.\start-manual.ps1` cho go2rtc/backend/frontend rồi chạy AI-Cam riêng.

### Kiểm tra webcam

```powershell
cd ai-cam
.\.venv\Scripts\python.exe scripts\list_cameras.py
# hoặc xem overlay trực tiếp:
.\.venv\Scripts\python.exe main.py   # rồi mở http://127.0.0.1:8090/
```

### Xuất TensorRT sau này (không phải training)

```powershell
.\.venv\Scripts\python.exe -m pip install tensorrt onnx onnxslim onnxruntime-gpu
.\.venv\Scripts\python.exe scripts\export_tensorrt.py --model all --imgsz 640
```

Engine tạo ra chỉ đúng cho RTX 3050 này — **không** dùng engine của VPS (RTX 5060 Ti).

### Đổi webcam → camera IP RTSP

Chỉ sửa cấu hình, không đổi pipeline AI:

```
CAMERA_SOURCE_TYPE=rtsp
CAMERA_URL=rtsp://user:password@192.168.1.10:554/Streaming/Channels/101
```

Hoặc thêm camera vào `go2rtc.yaml` rồi dùng `CAMERA_SOURCE_TYPE=go2rtc` với
`rtsp://127.0.0.1:8554/<tên-stream>`.

### Lỗi thường gặp

| Lỗi | Cách xử lý |
|---|---|
| `CUDA available: False` | Cài lại torch bản cu128 (xem `ai-cam/README.md`) |
| Không mở được webcam | Đổi `WEBCAM_DEVICE` / `WEBCAM_BACKEND=msmf` |
| `database "aicam" does not exist` | Chạy `ai-cam\scripts\init_aicam_db.ps1` |
| Trang biển số trống | Đặt `AICAM_DATABASE_URL` + `AICAM_EVENTS_DIR`, bỏ `MINIO_PUBLIC_URL` |
| go2rtc webcam lỗi | Chưa cài FFmpeg (hoặc cấu hình `ffmpeg.bin`) |
| Ảnh 404 trong UI | `AICAM_EVENTS_DIR` phải trùng `AI_CAM_STORAGE_DIR` |

### RTX 3050 4 GB

- Chỉ nạp model 1 lần (`ModelRegistry`); VRAM đo được ~250 MB.
- `AI_PROCESSING_FPS=5` mặc định; suy luận ~25-30 ms/frame.
- Giữ `AI_USE_FP16=true` trên CUDA; giảm FPS/độ phân giải nếu thiếu VRAM.

## Intrusion Detection Development

Module **INTRUSION** phát hiện **người** đi vào vùng ROI do người dùng vẽ trên
dashboard. Nguyên tắc thiết kế (bám sát yêu cầu):

- **Không huấn luyện lớp "intrusion".** Model chỉ phát hiện lớp `person`.
  "Xâm nhập" là **trạng thái runtime**: người được track có **bounding box
  chồng lên** polygon ROI.
- **Quyết định dựa trên BBOX chồng ROI, KHÔNG dựa vào điểm chân.** Điểm chân
  (bottom-center) không đáng tin với camera xa/cao (công trường, cột điện) khi
  bàn chân không nhìn thấy.
- **Tách bạch**: phát hiện người (`app/tasks/intrusion/task.py`) tách khỏi logic
  nghiệp vụ ROI (`geometry.py` + `state.py`).
- **Không sửa** module biển số / `vehicle_model.pt` / `plate_model.pt` / TrOCR.

### Cách xác định xâm nhập (bbox ∩ ROI)

```
roiOverlap = area(person_bbox ∩ roi_polygon) / area(person_bbox)
insideRoi  = roiOverlap >= INTRUSION_OVERLAP_THRESHOLD
```

- Mẫu số là **diện tích bbox của người** — **không** phải diện tích ROI và
  **không** dùng IoU với cả ROI (ROI có thể chiếm phần lớn khung hình).
- ROI là polygon tuỳ ý (kể cả **không lồi**): rasterize bằng `cv2.fillPoly` thành
  mask nhị phân, crop theo bbox rồi đếm pixel. Mask được **cache**, chỉ dựng lại
  khi ROI hoặc kích thước frame thay đổi.
- Ví dụ: bbox 10.000 px, 3.000 px nằm trong ROI → `roiOverlap = 0.30`.

**Vì sao không dùng điểm chân?** Với camera xa/cao (công trường, hạ tầng điện
lực), người rất nhỏ trong khung, bị che khuất, hoặc bàn chân ngoài khung → điểm
chân nằm ngoài ROI dù cả người đã ở trong vùng cấm. Tỉ lệ bbox chồng ROI ổn định
hơn nhiều trong các tình huống này.

#### Tinh chỉnh `INTRUSION_OVERLAP_THRESHOLD` (0.0 .. 1.0)

| Giá trị | Ý nghĩa |
|---|---|
| `0.05` | Rất nhạy — kích hoạt khi người vừa chạm vào ROI |
| `0.15` | **Mặc định khuyến nghị** |
| `0.30` | Cần một phần đáng kể thân người vào ROI |
| `0.50` | Cần khoảng một nửa bbox nằm trong ROI |

### Kiến trúc

```
ai-cam/app/tasks/intrusion/
├── geometry.py   # normalize_polygon, polygon_to_pixel, build_roi_mask,
│                 # box_roi_overlap_ratio, RoiMaskCache  (foot_point: chỉ để debug)
├── state.py      # IntrusionTracker: OUTSIDE→ENTERING→INSIDE→EXITED + dwell/cooldown
└── task.py       # IntrusionTask: YOLO person + ByteTrack → bbox∩ROI → event
```

Luồng runtime mỗi frame:

```
frame → person detector (YOLO) → bbox → ByteTrack (track ID)
      → roiOverlap = bbox ∩ ROI  (mask, polygon tuỳ ý)
      → insideRoi = roiOverlap >= INTRUSION_OVERLAP_THRESHOLD
      → debounce (min_inside_frames) + dwell (dwell_ms) + cooldown
      → sự kiện INTRUSION (một lần cho mỗi lần vào ROI đã xác nhận)
```

Payload mỗi detection: `{trackId, box, confidence, roiOverlap, insideRoi, state}`.

`AI_TASK_NAME=intrusion` chọn task này. Có thể dùng ngay model COCO
`models/intrusion/person_model.pt` (lớp 0 = person) — **không cần train** để chạy.
File model bị **gitignore** (không commit binary); cách lấy lại xem
[`ai-cam/README.md`](ai-cam/README.md) → *Getting the base model*.

### Chạy từ zero → dashboard

Thứ tự khởi động:

| # | Terminal | Lệnh | Ghi chú |
|---|---|---|---|
| 0 | – | `powershell -ExecutionPolicy Bypass -File .\scripts\setup-postgres.ps1 -Seed -LinkDevCamera` | chạy một lần |
| 1 | 1 | `.\go2rtc.exe` | chia sẻ webcam (single producer) |
| 2 | 2 | `cd backend; npm run dev` | :4000 |
| 3 | 3 | `cd frontend; npm run dev` | :3000 |
| 4 | 4 | `cd ai-cam; .\.venv\Scripts\python.exe main.py` | task intrusion |

Cấu hình `ai-cam\.env` cho intrusion:

```ini
AI_TASK_NAME=intrusion
CAMERA_SOURCE_TYPE=go2rtc
CAMERA_URL=rtsp://127.0.0.1:8554/laptop_webcam
STREAM_ID=laptop_webcam
PERSON_MODEL_PATH=models/intrusion/person_model.pt
PERSON_CONF_THRESH=0.35
INTRUSION_OVERLAP_THRESHOLD=0.15
AI_ROI_SOURCE=config
AI_ROI_POLL_SECONDS=5
MONITORING_API_URL=http://localhost:4000/api
MONITORING_API_KEY=demo-camera-key-change-me
MONITORING_CAMERA_ID=<uuid camera "Laptop Webcam">
```

> Chưa cài FFmpeg? Dùng `CAMERA_SOURCE_TYPE=webcam` + `WEBCAM_DEVICE=0` và **tắt**
> stream `laptop_webcam` trong go2rtc (tránh mở webcam 2 lần).

### Vẽ & cập nhật ROI

1. Dashboard → camera → module **INTRUSION** → mở hộp thoại vẽ ROI.
2. Vẽ polygon → lưu → `PATCH /api/modules/camera/{cameraId}/{moduleId}/config`.
3. Backend lưu `roiPolygon` (đã chuẩn hoá 0..1) vào `camera_modules.config` (PostgreSQL).
4. AI-Cam polling `GET /api/cameras/{id}/ai-config` (header `x-api-key`) mỗi
   `AI_ROI_POLL_SECONDS` → cập nhật ROI **không cần restart model**.

ROI lưu ở dạng **toạ độ chuẩn hoá** → không phụ thuộc độ phân giải; AI chuyển
sang pixel bằng kích thước frame thật lúc suy luận.

### Sự kiện INTRUSION

Khi có người vào ROI đã xác nhận, AI-Cam gọi `POST /api/events`:

```json
{
  "cameraId": "<uuid>",
  "eventType": "INTRUSION",
  "confidence": 0.91,
  "imageUrl": "http://localhost:4000/api/aicam-media/...",
  "timestamp": "2026-10-04T10:00:00Z"
}
```

Ảnh bằng chứng = **cả frame** (đã vẽ ROI + bbox vi phạm). Chỉ lưu **một ảnh cho
mỗi lần vào ROI đã xác nhận**. Dùng lại hạ tầng event/alert/Socket.IO sẵn có —
**không** tạo bảng event trùng.

### Checklist xác minh

- [ ] `.\scripts\setup-postgres.ps1 -Seed -LinkDevCamera` chạy xong, in "INTRUSION module present".
- [ ] `psql ... -c "SELECT code FROM ai_modules;"` có `INTRUSION`.
- [ ] Backend `npm run dev` không lỗi; `/api/health` trả JSON (401 nếu thiếu auth).
- [ ] Dashboard mở được; camera "Laptop Webcam" có module INTRUSION.
- [ ] Vẽ ROI → lưu → `camera_modules.config` có `roiPolygon`.
- [ ] `GET /api/cameras/{id}/ai-config` (x-api-key) trả `data.modules[].config.roiPolygon`.
- [ ] AI-Cam log thấy task `intrusion` + FPS; preview `http://127.0.0.1:8090/`.
- [ ] Đưa người vào ROI → xuất hiện event INTRUSION trên dashboard + ảnh bằng chứng.
- [ ] Đổi ROI khi AI-Cam đang chạy → ROI cập nhật trong ≤ `AI_ROI_POLL_SECONDS`.

### Test đơn vị

```powershell
cd ai-cam
.\.venv\Scripts\python.exe -m pytest tests -q
```

Bao phủ: tỉ lệ chồng bbox∩ROI (ngoài=0, trong≈1, 50%≈0.5, chạm cạnh≈0, dưới/đúng/
trên ngưỡng, polygon không lồi, bbox bị cắt bởi biên frame, ROI rỗng/không hợp lệ,
bbox nhỏ), chuẩn hoá→pixel, vào/ở/ra, bắn sự kiện một lần, cooldown, và trường hợp
**chân ngoài ROI nhưng thân người chồng ROI vẫn kích hoạt**.

### Bảo mật

- `GET /api/cameras/:id/ai-config` và `POST /api/events` yêu cầu `x-api-key` =
  `CAMERA_API_KEY`; **không** trả dữ liệu user/tài khoản/bí mật.
- Không commit `.env`, dataset, ảnh bằng chứng, model/engine lớn (đã gitignore).
- Không mở stream/webcam ra Internet.

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

## Reason Why PostgreSQL
1. Xử lí tốt dữ liệu hỗn hợp (user,role,rules,camera,events,logs,reports...)
2. Tối ưu cho dữ liệu chuỗi thời gian Và đánh index với tốc độ cao
3. Tương thích với typescript và Prisma cực tốt
4. Phù hợp với triển khai trên server nội bộ
5. Không phát sinh chi phí bản quyền