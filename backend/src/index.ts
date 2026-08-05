import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import http, { IncomingMessage, createServer } from 'http';
import path from 'path';
import { Server } from 'socket.io';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './openapi';

dotenv.config();

// Ensure evidence directory exists
const evidenceDir = path.join(__dirname, '../evidence');
if (!fs.existsSync(evidenceDir)) {
  fs.mkdirSync(evidenceDir, { recursive: true });
}

import { startHeartbeatWatchdog } from './heartbeat';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import cameraRoutes from './routes/cameras';
import captureRoutes from './routes/capture';
import eventRoutes from './routes/events';
import go2rtcRoutes from './routes/go2rtc';
import healthRoutes from './routes/health';
import layoutRoutes from './routes/layout';
import moduleRoutes from './routes/modules';
import reportRoutes from './routes/reports';
import userRoutes from './routes/users';
import licensePlateRoutes from './routes/license-plates';
import { initSocket } from './socket';

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

const corsOriginChecker = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) {
    callback(null, true);
    return;
  }
  const isAllowed = allowedOrigins.includes(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);
  if (isAllowed) {
    callback(null, true);
  } else {
    callback(null, false); // Do not throw error, just disallow to avoid server crash
  }
};

const io = new Server(httpServer, {
  cors: {
    origin: corsOriginChecker,
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: corsOriginChecker,
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Make socket.io accessible in routes
app.set('io', io);

// Serve evidence files statically
app.use('/evidence', express.static(evidenceDir));

// Serve aicam event media (license plate snapshots) by proxying to MinIO S3 service or fallback to disk
const defaultMinioDir = '/var/lib/minio/events';
const aicamEventsDir = process.env.AICAM_EVENTS_DIR || (fs.existsSync(defaultMinioDir) ? defaultMinioDir : evidenceDir);

const serveAicamMedia = (req: express.Request, res: express.Response) => {
  const rawPath = req.params[0] || '';
  const objectPath = rawPath.replace(/\/+$/, '');
  if (!objectPath) {
    res.status(400).json({ success: false, message: 'Invalid object path' });
    return;
  }

  const minioHost = process.env.MINIO_HOST || '127.0.0.1';
  const minioPort = process.env.MINIO_PORT || '9000';
  const minioBucket = process.env.MINIO_BUCKET || 'events';
  const targetUrl = `http://${minioHost}:${minioPort}/${minioBucket}/${objectPath}`;

  const reqClient = http.get(targetUrl, (minioRes: IncomingMessage) => {
    if (minioRes.statusCode === 200) {
      res.setHeader('Content-Type', minioRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      minioRes.pipe(res);
    } else {
      const fallbackFilePath = path.join(aicamEventsDir, objectPath);
      if (fs.existsSync(fallbackFilePath) && fs.statSync(fallbackFilePath).isFile()) {
        res.sendFile(fallbackFilePath);
      } else {
        res.status(minioRes.statusCode || 404).json({ success: false, message: 'Image not found in MinIO' });
      }
    }
  });

  reqClient.on('error', () => {
    const fallbackFilePath = path.join(aicamEventsDir, objectPath);
    if (fs.existsSync(fallbackFilePath) && fs.statSync(fallbackFilePath).isFile()) {
      res.sendFile(fallbackFilePath);
    } else {
      res.status(404).json({ success: false, message: 'Failed to fetch image from MinIO' });
    }
  });
};

app.get('/api/aicam-media/*', serveAicamMedia);
app.get('/aicam-media/*', serveAicamMedia);

// API docs (Swagger UI)
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec as any));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/capture', captureRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/go2rtc', go2rtcRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/layout', layoutRoutes);
app.use('/api/license-plates', licensePlateRoutes);

app.use(errorHandler);

initSocket(io);
startHeartbeatWatchdog(io);

const PORT = parseInt(process.env.PORT || '4000', 10);
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
