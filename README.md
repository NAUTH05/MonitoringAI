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

## Bắt đầu nhanh (local dev — Windows)

Hai script lo toàn bộ vòng đời local. **Không** cần mở 4 terminal và **không**
cần sửa `go2rtc.yaml` hay biến `.env` cho từng camera.

**Cài đặt một lần:**

```powershell
.\scripts\setup-local.ps1 -Seed
```

Kiểm tra toolchain (Node, Python venv, ffmpeg, go2rtc), tạo `.env` từ mẫu, cài
`node_modules` còn thiếu và khởi tạo database (uỷ quyền cho
`scripts/setup-postgres.ps1` — **không bao giờ xoá dữ liệu hiện có**).

**Chạy hằng ngày:**

```powershell
.\scripts\start-local.ps1
```

Khởi động go2rtc → backend → frontend → AI-Cam, chờ health check rồi in URL:

| Dịch vụ | URL |
|---|---|
| MonitoringAI | http://localhost:3000 |
| Backend | http://localhost:4000 |
| go2rtc | http://localhost:1984 |
| AI-Cam | http://localhost:8090 |

**Dừng:**

```powershell
.\scripts\stop-local.ps1
```

Cần chạy tay từng dịch vụ hoặc cấu hình go2rtc thủ công? Xem
[Advanced / Xử lý sự cố](#advanced--xử-lý-sự-cố).

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

## Thêm camera & AI (workflow mới)

Camera là **dữ liệu trong database**, không phải biến `.env`. Thêm một camera
không cần sửa file nào và không cần restart dịch vụ AI.

1. **Chạy dịch vụ** — `.\scripts\start-local.ps1`
2. **Đăng nhập** dashboard tại http://localhost:3000
3. **Add Camera** — nút thêm camera trên trang Cameras
4. **Chọn nguồn hình** — một trong 4 loại (bảng dưới)
5. **Test connection** — backend kiểm tra nguồn trước khi lưu
6. **Chọn mô-đun AI** — ví dụ `Intrusion Detection`
7. **Vẽ vùng cấm** — mở camera → module INTRUSION → vẽ ROI
8. **Theo dõi cảnh báo** — sự kiện realtime + bằng chứng trong Event Detail

### Các loại nguồn hình

| Loại | Người dùng nhập | Ghi chú |
|---|---|---|
| **IP Camera / RTSP** | URL RTSP (+ user/pass tuỳ chọn) | Cho camera IP hoặc NVR |
| **Local Webcam** | Chọn thiết bị + độ phân giải + FPS | Thiết bị gắn vào **máy chạy go2rtc**; chỉ để phát triển |
| **Existing go2rtc stream** | Chọn từ danh sách | Dùng lại luồng đã cấu hình |
| **NVR / Advanced** | URL RTSP đầy đủ | Cấu hình chi tiết cho đầu ghi |

Backend tự sinh **tên stream nội bộ** (`cam_<uuid>`) — người dùng không bao giờ
nhập tên stream hay chuỗi `ffmpeg:device?...`.

### Backend làm gì khi tạo camera (transaction)

```
Frontend -> Backend -> kiểm tra nguồn -> cấu hình go2rtc -> xác minh stream
        -> lưu camera (streamName + aiSourceUrl) -> gán mô-đun AI
        -> AI-Cam tự phát hiện
```

Nếu go2rtc lỗi: **không** tạo camera hỏng, trả lỗi rõ ràng cho UI và dọn stream
tạm. Sửa nguồn sẽ cập nhật đúng stream đó; xoá camera sẽ dọn stream do nó quản
lý (chỉ khi không camera nào khác dùng).

### AI-Cam chạy nhiều camera

AI-Cam polling `GET /api/ai/runtime-config` (header `x-api-key`) và tự
**thêm / bỏ / khởi động lại** worker theo từng camera — **không** restart cả
dịch vụ khi thêm một camera. `.env` của AI-Cam chỉ còn cấu hình **cấp dịch vụ**
(model path, device, storage, URL backend...).

## Advanced / Xử lý sự cố

Chỉ dành cho cấu hình thủ công / gỡ lỗi. Quy trình thường ngày **không** cần.

### Cấu hình go2rtc thủ công

`go2rtc.yaml` chỉ nên chứa cấu hình cấp dịch vụ (`api.listen`, `rtsp.listen`,
`ffmpeg.bin`). Stream do người dùng tạo được backend quản lý qua go2rtc API —
**không** sửa YAML bằng tay.

```yaml
api:
  listen: ":1984"
rtsp:
  listen: ":8554"
# ffmpeg:
#   bin: C:\ffmpeg\bin\ffmpeg.exe
```

Muốn thêm luồng có sẵn (ví dụ `laptop_webcam`), dùng tab **go2rtc Streams** trên
UI hoặc gọi thẳng go2rtc API:

```
PUT http://localhost:1984/api/streams?name=laptop_webcam&src=ffmpeg:device?video=0&resolution=1280x720&framerate=30#video=h264
```

### Chế độ một camera (legacy)

Đặt `AI_RUNTIME_CONFIG=false` trong `ai-cam/.env` để quay lại đọc nguồn từ
`CAMERA_SOURCE_TYPE` / `CAMERA_URL` / `STREAM_ID` / `MONITORING_CAMERA_ID`.
Chỉ dùng cho test offline hoặc demo cố định.

### Lỗi thường gặp

| Lỗi | Cách xử lý |
|---|---|
| `CUDA available: False` | Cài torch bản cu128 (xem `ai-cam/README.md`) |
| Không tìm thấy thiết bị webcam | ffmpeg chưa có trên PATH của máy chạy backend |
| `go2rtc rejected the source` | Kiểm tra URL RTSP / thiết bị, thử "Test connection" |
| Stream không khả dụng | Nguồn chưa sẵn sàng — kiểm tra camera/NVR và go2rtc |
| `database "aicam" does not exist` | Chạy `scripts\setup-postgres.ps1` |
| Ảnh 404 trong UI | `AICAM_EVENTS_DIR` phải trùng `AI_CAM_STORAGE_DIR` |
| Trang biển số trống | Đặt `AICAM_DATABASE_URL` + `AICAM_EVENTS_DIR` |

### Xuất TensorRT (không phải training)

```powershell
cd ai-cam
.\.venv\Scripts\python.exe -m pip install tensorrt onnx onnxslim onnxruntime-gpu
.\.venv\Scripts\python.exe scripts\export_tensorrt.py --model all --imgsz 640
```

Engine chỉ đúng cho GPU hiện tại — **không** dùng engine của máy khác.

### RTX 3050 4 GB

- Chỉ nạp model 1 lần (`ModelRegistry`) và **chia sẻ** giữa các camera worker.
- `AI_PROCESSING_FPS=5` mỗi camera; suy luận ~25-30 ms/frame.
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

```powershell
.\scripts\setup-local.ps1 -Seed     # một lần
.\scripts\start-local.ps1           # mỗi lần làm việc
```

Sau đó trong dashboard: **Add Camera** → chọn nguồn → **Test connection** → chọn
mô-đun **Intrusion Detection** → vẽ vùng cấm. AI-Cam tự phát hiện camera mới qua
`GET /api/ai/runtime-config` — **không** sửa `.env` cho từng camera.

`ai-cam/.env` chỉ còn cấu hình **cấp dịch vụ**:

```ini
PERSON_MODEL_PATH=models/intrusion/person_model.pt
PERSON_CONF_THRESH=0.35
INTRUSION_OVERLAP_THRESHOLD=0.15
INTRUSION_EVIDENCE_INTERVAL_SECONDS=3
INTRUSION_RECORD_POSTROLL_SECONDS=5
INTRUSION_RECORD_MAX_SECONDS=120
AI_RUNTIME_CONFIG=true
MONITORING_API_URL=http://localhost:4000/api
MONITORING_API_KEY=demo-camera-key-change-me
```

> Chạy tay từng dịch vụ trong 4 terminal vẫn được, và chế độ một camera (legacy)
> vẫn tồn tại — xem [Advanced / Xử lý sự cố](#advanced--xử-lý-sự-cố).

### Vẽ & cập nhật ROI

1. Dashboard → camera → module **INTRUSION** → mở hộp thoại vẽ ROI.
2. Vẽ polygon → lưu → `PATCH /api/modules/camera/{cameraId}/{moduleId}/config`.
3. Backend lưu `roiPolygon` (đã chuẩn hoá 0..1) vào `camera_modules.config` (PostgreSQL).
4. AI-Cam nhận `roiPolygon` từ payload `GET /api/ai/runtime-config` (mỗi
   `AI_RUNTIME_CONFIG_POLL_SECONDS`) → cập nhật ROI **không cần restart model**
   và **không restart worker**.

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

> **Thường ngày bạn KHÔNG cần mục này.** Thêm camera qua UI (**Add Camera**) —
> backend tự cấu hình go2rtc và sinh tên stream. Phần này chỉ dành cho cấu hình
> thủ công / nâng cao.

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

## Kiểm thử (tests)

```powershell
# AI-Cam (Python) — 84 bài
cd ai-cam; .\.venv\Scripts\python.exe -m pytest tests -q

# Backend (Node, không cần dependency mới)
cd backend; npm test

# Frontend (Node)
cd frontend; npm test
```

Bao phủ: tỉ lệ bbox∩ROI + state machine, **evidence session** (1 event / snapshot
3s / video post-roll / giới hạn 120s / nhiều camera độc lập), **multi-camera
reconcile** (thêm / bỏ / disable / ROI cập nhật live không restart), **storage**
(local ảnh + bytes + file, interface MinIO), **go2rtc orchestration** (sinh tên
stream, build source, URL), **seed không tạo dữ liệu giả**, và các guard UI
(không còn mock 2x2, event detail dùng chung, wizard đi qua `/cameras/provision`).

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