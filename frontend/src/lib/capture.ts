import { api } from "@/lib/api";
import { ApiResponse } from "@/types";

// Trigger a browser download of a Blob.
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

// ---- Client-side (download to the viewer's machine) -----------------------

export function captureFrameLocal(video: HTMLVideoElement, name: string): boolean {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return false;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(video, 0, 0, w, h);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `snap_${name}_${stamp()}.jpg`);
  }, "image/jpeg", 0.92);
  return true;
}

export function recordLocal(
  video: HTMLVideoElement,
  name: string,
  durationMs: number,
): boolean {
  const stream = (video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  });
  const src = stream.captureStream?.() ?? stream.mozCaptureStream?.();
  if (!src) return false;
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const rec = new MediaRecorder(src, { mimeType: mime });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    downloadBlob(new Blob(chunks, { type: "video/webm" }), `rec_${name}_${stamp()}.webm`);
  };
  rec.start();
  setTimeout(() => rec.state !== "inactive" && rec.stop(), durationMs);
  return true;
}

// ---- Server-side (saved into evidence/ on the server) ----------------------

export async function captureFrameServer(streamName: string): Promise<string> {
  const res = await api.post<ApiResponse<{ url: string }>>(
    `/capture/${encodeURIComponent(streamName)}/snapshot`,
    {},
  );
  return res.data.url;
}

export async function recordServer(streamName: string, seconds: number): Promise<string> {
  const res = await api.post<ApiResponse<{ url: string }>>(
    `/capture/${encodeURIComponent(streamName)}/record`,
    { duration: seconds },
  );
  return res.data.url;
}
