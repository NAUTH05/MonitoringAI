# AI-Cam — local inference runtime

Local AI inference runtime built around the **already-trained** models copied
from the production/VPS AI system. This runtime **does not train, fine-tune,
quantize, delete or overwrite** the original `.pt`, `.onnx` or TrOCR files.

```
ai-cam/
├── vehicle_model.pt / .onnx      # trained YOLO vehicle detector (read-only)
├── plate_model.pt / .onnx        # trained YOLO plate detector   (read-only)
├── trocr_vn_plate_final/         # trained TrOCR OCR model       (read-only)
├── models/intrusion/
│   └── person_model.pt           # COCO person detector (class 0 = person)
├── datasets/intrusion_person/    # person dataset root (empty; see TRAINING)
├── app/                          # runtime application code
│   └── tasks/intrusion/          # geometry + state machine + task
├── scripts/                      # helper scripts
├── sql/                          # AI-Cam DB schema + camera linkage
├── requirements.txt
├── .env.example
└── main.py
```

## Relationship to TRAINING

| Task | Command | This repo |
|---|---|---|
| Train vehicle/plate YOLO | `yolo train ...` | **NOT** done here |
| Train TrOCR | `python train_trocr.py` | **NOT** done here |
| Train intrusion person YOLO | `scripts/train_person_detector.py` | Supported (needs your dataset) |
| TensorRT export (not training) | `scripts/export_tensorrt.py` | Optional, explicit |
| Inference | `main.py` | This runtime |

## Architecture

```
                 ┌─────────────── single producer ───────────────┐
 Laptop webcam ──┤  (go2rtc/ffmpeg DirectShow  OR  OpenCV)       │
 IP camera ──────┘                                              │
        │                                                       │
        ├──────────────► MonitoringAI live view (go2rtc MSE)    │
        │                                                       │
        └──────────────► AI-Cam frame source ─► latest-frame buffer
                                    │ (AI_PROCESSING_FPS, default 5)
                                    ▼
                         LicensePlateTask
                    vehicle YOLO + ByteTrack
                                    ▼
                          vehicle crop ─► plate YOLO
                                    ▼
                    plate crop validation (size/aspect)
                                    ▼
                                  TrOCR
                                    ▼
                   VN normalization + per-track voting
                                    ▼
                  evidence JPEGs (local) + aicam.events row
                                    ▼
                     MonitoringAI /api/license-plates (reads aicam DB)
```

Camera acquisition and AI inference are deliberately separated:

- `app/sources/` owns the physical camera/stream.
- `app/core/capture.py` is the **only** place a camera is read.
- `app/tasks/license_plate/` only receives ready frames.

Switching from webcam to an IP camera is a configuration change only.

## Prerequisites

- Windows 11 + NVIDIA driver (RTX 3050 Laptop, 4 GB)
- Python 3.12 (the existing `ai-cam/.venv`)
- PostgreSQL 16 running locally
- go2rtc (`go2rtc.exe` at the repo root) — only for the shared live-view stream
- FFmpeg — only needed by go2rtc to capture the webcam / transcode H265

## 1. Python environment

The repository already contains `ai-cam/.venv`. If you recreate it:

```powershell
cd C:\Work\PROJECTS\monitoringAI\ai-cam
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
# CUDA PyTorch for the RTX 3050 (CUDA 12.8 build):
.\.venv\Scripts\python.exe -m pip install --index-url https://download.pytorch.org/whl/cu128 torch torchvision
# Remaining runtime deps:
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Verify CUDA and the models:

```powershell
.\.venv\Scripts\python.exe scripts\check_gpu.py
.\.venv\Scripts\python.exe scripts\test_models.py
```

`test_models.py` prints the class names read from the models themselves
(vehicle: `{0: motorcycle, 1: car, 2: bus, 3: truck}`, plate: `{0: BSD, 1: BSV}`).

## 2. Configuration

```powershell
Copy-Item .env.example .env
```

> **Cameras come from the database, not from `.env`.** By default
> (`AI_RUNTIME_CONFIG=true`) the runtime discovers every enabled camera from
> `GET /api/ai/runtime-config` and runs one worker per camera — adding a camera
> is a UI action. The per-camera variables below (`CAMERA_SOURCE_TYPE`,
> `CAMERA_URL`, `STREAM_ID`, `MONITORING_CAMERA_ID`, `AI_TASK_NAME`) are the
> **legacy single-camera fallback** used only when `AI_RUNTIME_CONFIG=false`.

Key settings (see `.env.example` for the full list and explanations):

| Variable | Default | Meaning |
|---|---|---|
| `CAMERA_SOURCE_TYPE` | `webcam` | `webcam` \| `rtsp` \| `go2rtc` |
| `WEBCAM_DEVICE` | `0` | webcam index (verify with `scripts/list_cameras.py`) |
| `CAMERA_URL` | – | RTSP URL for `rtsp`/`go2rtc` modes |
| `STREAM_ID` | `laptop_webcam` | written to `aicam.events.stream_id` |
| `AI_PROCESSING_FPS` | `5` | inference rate (preview keeps camera FPS) |
| `AI_DEVICE` | `auto` | `auto` \| `cuda` \| `cpu` |
| `AI_CAM_STORAGE_MODE` | `local` | `local` \| `minio` |
| `AICAM_DATABASE_URL` | `.../aicam` | AI-Cam event database |

### Thresholds (all configurable)

| Variable | Default | Notes |
|---|---|---|
| `VEHICLE_CONF_THRESH` | `0.5` | vehicle detection confidence |
| `PLATE_CONF_THRESH` | `0.4` | plate detection confidence |
| `MIN_PLATE_LENGTH` / `MAX_PLATE_LENGTH` | `6` / `9` | accepted plate text length |
| `TRACK_STALE_FRAMES` | `30` | frames a track must be gone before finalizing |
| `PLATE_CROP_PADDING` | `2` | pixels added around the plate box |
| `MIN_PLATE_CROP_W` / `MIN_PLATE_CROP_H` | `16` / `8` | reject tiny crops before TrOCR |
| `MIN_PLATE_ASPECT` / `MAX_PLATE_ASPECT` | `0.15` / `8.0` | reject malformed crop shapes |

These guards exist because the production logs showed Transformers warnings
from extremely small/malformed plate crops.

### Intrusion thresholds (task `intrusion`)

| Variable | Default | Notes |
|---|---|---|
| `PERSON_CONF_THRESH` | `0.35` | person detection confidence |
| `INTRUSION_OVERLAP_THRESHOLD` | `0.15` | min **bbox∩ROI overlap ratio** to count as inside (0.0..1.0). `0.05` = very sensitive, `0.15` = recommended, `0.30` = significant body, `0.50` = ~half the bbox |
| `INTRUSION_MIN_INSIDE_FRAMES` | `3` | debounce: consecutive inside frames before confirming |
| `INTRUSION_DWELL_MS` | `1000` | minimum dwell inside the ROI (ms) |
| `INTRUSION_EVENT_COOLDOWN_MS` | `5000` | min time between events for the SAME track |
| `INTRUSION_ROI_EXIT_FRAMES` | `5` | consecutive outside frames before a track is re-armed (EXITED) |
| `INTRUSION_TRACK_LOST_FRAMES` | `30` | frames without a track before its state is dropped |
| `AI_ROI_SOURCE` | `config` | `config` = poll backend ai-config; `static` = offline file/inline |
| `AI_ROI_POLL_SECONDS` | `5` | ROI re-read interval (live ROI edit, no model restart) |

`INTRUSION_OVERLAP_THRESHOLD` is the knob that matters most: the intrusion
decision is `roiOverlap >= INTRUSION_OVERLAP_THRESHOLD`, where `roiOverlap` is the
fraction of the person bbox inside the ROI (never the foot point).

## 3. AI-Cam database

License-plate data is read by MonitoringAI from the **separate `aicam`
database**. Create it once (needs your PostgreSQL superuser password):

```powershell
.\scripts\init_aicam_db.ps1
# or directly:
.\.venv\Scripts\python.exe scripts\init_aicam_db.py --admin-dsn "postgresql://postgres@localhost:5432/postgres"
```

Then make sure `backend/.env` points at it:

```
AICAM_DATABASE_URL="postgresql://monitoring:monitoring_pass@localhost:5432/aicam"
AICAM_EVENTS_DIR="C:/Work/PROJECTS/monitoringAI/ai-cam/data/events"
# leave MINIO_PUBLIC_URL unset for local storage
```

## 4. Link the webcam to a MonitoringAI camera

Creates (idempotently) a `Laptop Webcam` camera whose `rtsp_url` embeds the
go2rtc stream name, so live view and license-plate name mapping are
deterministic:

```powershell
.\scripts\link_monitoring_camera.ps1
```

## 5. Run

```powershell
.\scripts\run.ps1
# or
.\.venv\Scripts\python.exe main.py
```

Diagnostics while running:

- Console log every 5 s: capture FPS, measured FPS, detections, tracks, events.
- Browser preview (works even without go2rtc/FFmpeg):
  `http://127.0.0.1:8090/` (MJPEG overlay)
- Status JSON: `http://127.0.0.1:8090/status`
- Snapshot: `http://127.0.0.1:8090/preview.jpg`

The absence of vehicles/plates is **not** a failure — the `alive` log line and
the status endpoint confirm inference is running with zero detections.

## 6. Webcam sharing (single producer)

The physical webcam must be captured **once**. Two supported modes:

### A. go2rtc as the single producer (recommended for the demo)

1. Install FFmpeg and ensure `ffmpeg.exe` is on `PATH` (or set `ffmpeg.bin`
   in `go2rtc.yaml`).
2. `go2rtc.yaml` already contains the development stream:

   ```yaml
   streams:
     laptop_webcam:
       - "ffmpeg:device?video=0&resolution=1280x720&framerate=30#video=h264"
   ```

3. Start go2rtc: `.\go2rtc.exe`
   - MonitoringAI live view reads `ws://localhost:1984/...src=laptop_webcam`
   - AI-Cam consumes the restream: set

     ```
     CAMERA_SOURCE_TYPE=go2rtc
     CAMERA_URL=rtsp://127.0.0.1:8554/laptop_webcam
     ```

   Both consumers share the one physical capture.

### B. Direct OpenCV capture (no FFmpeg needed)

```
CAMERA_SOURCE_TYPE=webcam
WEBCAM_DEVICE=0
```

AI-Cam opens the webcam directly. In this mode do **not** also configure the
go2rtc `laptop_webcam` stream, otherwise Windows would open the device twice.
The local diagnostic preview at `:8090` still shows the annotated feed.

## 7. Switch webcam → IP camera RTSP later

Only change configuration — the AI pipeline is untouched:

```
CAMERA_SOURCE_TYPE=rtsp
CAMERA_URL=rtsp://<user>:<pass>@<camera-ip>:554/Streaming/Channels/101
RTSP_TRANSPORT=tcp
STREAM_ID=<go2rtc stream name or camera id convention>
```

For go2rtc sharing, add the camera to `go2rtc.yaml` and use
`CAMERA_SOURCE_TYPE=go2rtc` with the `rtsp://127.0.0.1:8554/<name>` URL.

## 8. TensorRT export (optional, explicit)

TensorRT engines are GPU-specific. **Never** copy the RTX 5060 Ti `.engine`
files from the VPS. Build locally on the RTX 3050:

```powershell
.\.venv\Scripts\python.exe -m pip install tensorrt onnx onnxslim onnxruntime-gpu
.\.venv\Scripts\python.exe scripts\export_tensorrt.py --model all --imgsz 640
```

The script verifies CUDA, prints the GPU, refuses if source `.pt` is missing,
exports FP16 by default, keeps the `.pt` files intact and validates that the
new engine loads. Restart AI-Cam afterwards; engines are preferred automatically.

## 9. Storage

- `AI_CAM_STORAGE_MODE=local` (default): JPEGs under `AI_CAM_STORAGE_DIR` as
  `{stream_id}/{YYYY-MM-DD}/{event_id}.jpg` (vehicle crop) and
  `..._thumb.jpg` (plate crop). Served by MonitoringAI via `/api/aicam-media/...`.
- `AI_CAM_STORAGE_MODE=minio`: same object keys in a MinIO bucket
  (`pip install minio`).

Event images intentionally store the **vehicle crop** (main) and **plate crop**
(thumbnail), matching the production behaviour.

## 10. MonitoringAI realtime push (optional)

The license-plate page reads the DB directly. To also raise a generic
`VEHICLE` event (socket alert) set:

```
MONITORING_API_URL=http://localhost:4000/api
MONITORING_API_KEY=<CAMERA_API_KEY from backend/.env>
MONITORING_CAMERA_ID=<uuid of the Laptop Webcam camera>
```

## 11. RTX 3050 4 GB notes

- Only one copy of each model is loaded (`ModelRegistry`); GPU usage measured
  ~250 MB (fp16 YOLO + TrOCR fp32).
- `AI_PROCESSING_FPS=5` keeps the GPU cool; steady-state inference is ~25-30 ms
  per frame, so 5 FPS is comfortable.
- Keep `AI_USE_FP16=true` on CUDA.
- TrOCR runs fp32; that is the largest model (~250 MB weights).
- If VRAM pressure appears, lower `AI_PROCESSING_FPS` and/or `WEBCAM_WIDTH/HEIGHT`.

## 12. Troubleshooting

| Symptom | Fix |
|---|---|
| `CUDA available : False` | Install the cu128 torch build (section 1) and rerun `check_gpu.py` |
| No webcam | Run `scripts/list_cameras.py`, try another `WEBCAM_DEVICE` / `WEBCAM_BACKEND=msmf` |
| `database "aicam" does not exist` | Run `scripts/init_aicam_db.ps1` |
| License plate page empty | Run backend, ensure `AICAM_DATABASE_URL`/`AICAM_EVENTS_DIR` are set, no `MINIO_PUBLIC_URL` |
| go2rtc webcam fails | FFmpeg not on PATH — install it or set `ffmpeg.bin` |
| Images 404 in UI | `AICAM_EVENTS_DIR` must equal `AI_CAM_STORAGE_DIR` |
| `'half' deprecated` removed | Already avoided: runtime passes `quantize=16` |

## INTRUSION AI TRAINING

Everything needed to (re)train the **person detector** used by the `intrusion`
task. The runtime does **not** need a custom model — a COCO checkpoint works out
of the box. Training is only needed to specialise the detector for your own
cameras.

> **Getting the base model.** `models/intrusion/person_model.pt` is gitignored
> (model binaries are never committed). If it is missing, drop any YOLO checkpoint
> that has a `person` class there — e.g. the COCO `yolov8n.pt`:
>
> ```powershell
> .\.venv\Scripts\python.exe -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
> Copy-Item yolov8n.pt models\intrusion\person_model.pt
> ```
>
> Or point `PERSON_MODEL_PATH` in `ai-cam/.env` at any compatible `.pt`.

> **Never train an "intrusion" class.** The detector only ever learns `person`
> (class 0). "Intrusion" is a **runtime state** produced by the ROI logic in
> `app/tasks/intrusion/` (see [`../README.md`](../README.md) → *Intrusion
> Detection Development*). Detection and ROI business logic are deliberately
> separate.
>
> The runtime decides "inside the ROI" from the **fraction of the person's
> bounding box that overlaps the ROI polygon** (`roiOverlap >=
> INTRUSION_OVERLAP_THRESHOLD`, default `0.15`) — **not** from the bottom-center
> foot point, which is unreliable on distant/elevated CCTV.

### 1. Where the data comes from

There is **no dataset in this repo** (frames/labels are gitignored). The dataset
root exists but is empty:

```
datasets/intrusion_person/
├── data.yaml                 # nc: 1, names: {0: person}
├── images/{train,val,test}/  # .gitkeep only
├── labels/{train,val,test}/  # .gitkeep only
└── _pool/                    # created by the extract step
```

Use real footage from your own CCTV/NVR, or record clips with the laptop webcam
(`scripts/list_cameras.py`). Do **not** commit footage or labels.

### 2. Extract frames

```powershell
cd C:\Work\PROJECTS\monitoringAI\ai-cam
.\.venv\Scripts\python.exe scripts\prepare_intrusion_dataset.py extract `
    --source "D:\cctv_footage" --fps 1
```

One **group per source video** is created under `_pool/` (folder = video stem) —
this is what later prevents leakage. Add `--overwrite` to re-extract.

### 3. Label

Label with any YOLO tool (LabelImg / CVAT / Roboflow). Requirements:

- YOLO format: `<stem>.txt` next to the image.
- **Only class 0 = person.** Any other class id is rejected by validation.
- An **empty** `.txt` = a valid negative frame (background). Negatives are allowed
  and encouraged — they reduce false positives.
- Pseudo-labels must stay in a **separate** folder and be reviewed before merging.

### 4. Split (group-aware)

```powershell
.\.venv\Scripts\python.exe scripts\prepare_intrusion_dataset.py split `
    --val 0.2 --test 0.1 --seed 42
```

Groups (source videos) are **never** split across sets, so near-identical
consecutive frames cannot leak from train into val/test. Unlabelled frames are
ignored (no fake ground truth). Writes `split_manifest.json`.

### 5. Inspect / validate

```powershell
.\.venv\Scripts\python.exe scripts\inspect_dataset.py                 # counts + warnings
.\.venv\Scripts\python.exe scripts\inspect_dataset.py --samples 8     # render previews
.\.venv\Scripts\python.exe scripts\validate_yolo_dataset.py           # strict checks
```

`validate_yolo_dataset.py` checks image/label pairing, class ids, box ranges and
near-duplicate (average-hash) leakage across splits.

### 6. Train

```powershell
# check the plan first (validates the dataset, trains nothing)
.\.venv\Scripts\python.exe scripts\train_person_detector.py --dry-run

# real run (conservative defaults for a 4 GB RTX 3050)
.\.venv\Scripts\python.exe scripts\train_person_detector.py --epochs 100 --batch 8
```

Defaults: `model=yolov8n.pt`, `imgsz=640`, `batch=8`, `device=0`, `amp=True`,
`cache=False`, `patience=30`, `seed=0`, `deterministic=True`. Every run goes to a
**unique** directory `runs/intrusion_person/person_<timestamp>/` (`exist_ok=False`,
previous runs are never overwritten).

The script **refuses to run** if `images/train` or `images/val` is empty — it will
never fabricate a dataset or pretend training happened.

### 7. Evaluate

```powershell
# dataset metrics (precision, recall, mAP50, mAP50-95, confusion matrix)
.\.venv\Scripts\python.exe scripts\evaluate_person_detector.py --metrics --split val

# sanity-check on a single image / video / the webcam
.\.venv\Scripts\python.exe scripts\evaluate_person_detector.py --image test.jpg
.\.venv\Scripts\python.exe scripts\evaluate_person_detector.py --webcam `
    --roi '[{"x":0.1,"y":0.2},{"x":0.8,"y":0.2},{"x":0.8,"y":0.8}]'
.\.venv\Scripts\python.exe scripts\evaluate_person_detector.py --webcam `
    --roi .\roi-test.json --overlap-threshold 0.30
```

`--roi` accepts **both** an inline JSON string **and** a path to a JSON file
(containing `[{x,y}, ...]` or `{"roiPolygon": [...]}`). The live `cv2.imshow`
preview draws the ROI polygon and, for every detected person, the bbox, track id,
confidence and the **ROI overlap percentage** — so you can see exactly why someone
triggers. Judge the model on precision/recall/mAP, **not** on training loss alone.

### 8. Deploy

On success the best checkpoint is copied to `models/intrusion/person_model.pt`
(an existing file is first backed up to `person_model.prev.pt`). The run's own
`best.pt` / `last.pt` stay in the run directory. Nothing else is touched — the
license-plate models are never modified.

`ai-cam/.env` already points at that path:

```ini
PERSON_MODEL_PATH=models/intrusion/person_model.pt
```

### 9. Use with the intrusion runtime

Restart AI-Cam; it loads `person_model.pt` and runs the ROI state machine. See
[`../README.md`](../README.md) → *Intrusion Detection Development* for the ROI and
event flow (`AI_TASK_NAME=intrusion`).

### 10. Optional TensorRT export

```powershell
.\.venv\Scripts\python.exe scripts\export_intrusion_tensorrt.py --imgsz 640
```

GPU-specific — build on the RTX 3050, never copy the VPS engine. Separate from
training. `PERSON_ENGINE_PATH` is preferred automatically when present.

### 11. GPU / VRAM notes

- RTX 3050 Laptop 4 GB. `batch=8 @ 640` is comfortable; watch `nvidia-smi`.
- `cache=False` avoids pinning the whole dataset in RAM.
- At inference only one copy of each model is loaded (`ModelRegistry`).

### 12. CUDA out of memory

```
1) --batch 4      (or 2)
2) --imgsz 512
3) close other GPU apps (browsers, games, other AI processes)
4) set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
```

Do **not** ignore OOM — training did not complete.

### 13. Status / limitations

- **No usable person dataset exists in this repo** → training has **not** been run.
  No metrics are reported because none were produced. The runtime uses the
  COCO-pretrained `person_model.pt` at `models/intrusion/person_model.pt` (gitignored;
  see *Getting the base model* above).
- To actually train: supply footage (step 2) → label (step 3) → split → validate →
  train. Only then can real metrics be reported.
- Unit tests (geometry + state machine + task, no GPU required):

  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests -q
  ```

## Security

- `.env` and `ai-cam/data/` are gitignored.
- Model binaries, engines and the VPS snapshot are gitignored.
- The diagnostic server binds to `127.0.0.1` only.
- Never expose the webcam/RTSP stream to the public internet.
