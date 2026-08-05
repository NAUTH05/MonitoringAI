export type CameraStatus = 'ONLINE' | 'OFFLINE' | 'ERROR';
export type EventType = 'INTRUSION' | 'FIRE' | 'SMOKE' | 'PPE' | 'FACE' | 'VEHICLE';
export type AlertStatus = 'UNREAD' | 'READ' | 'ACKNOWLEDGED';
export type UserRole = 'Admin' | 'Manager' | 'Operator' | 'Viewer';

export interface Role {
  id: string;
  name: UserRole;
}

export interface User {
  id: string;
  username: string;
  email: string;
  roleId: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiModule {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CameraModule {
  id: string;
  cameraId: string;
  moduleId: string;
  isEnabled: boolean;
  config?: {
    roiPolygon?: Array<{ x: number; y: number }>;
    [key: string]: unknown;
  } | null;
  module: AiModule;
  createdAt: string;
}

export interface Camera {
  id: string;
  name: string;
  location: string;
  rtspUrl: string;
  subRtspUrl?: string;
  status: CameraStatus;
  isActive: boolean;
  lastHeartbeat?: string;
  createdAt: string;
  updatedAt: string;
  cameraModules?: CameraModule[];
  _count?: { events: number };
}

export interface Alert {
  id: string;
  eventId: string;
  status: AlertStatus;
  acknowledgedAt?: string;
  createdAt: string;
  event?: Event;
}

export interface Event {
  id: string;
  cameraId: string;
  eventType: EventType;
  confidence: number;
  imageUrl?: string;
  videoUrl?: string;
  timestamp: string;
  isAlert: boolean;
  camera: { id: string; name: string; location: string };
  alert?: Alert;
  createdAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: { total: number; page: number; limit: number };
  message?: string;
}

export interface DashboardStats {
  totalCameras: number;
  onlineCameras: number;
  offlineCameras: number;
  todayAlerts: number;
  weekAlerts: number;
  dailyStats: { date: string; count: number }[];
  topCameras: { cameraId: string; cameraName: string; count: number }[];
}

export interface SystemHealth {
  server: {
    status: string;
    uptime: string;
    cpuUsage: string;
    memUsage: string;
    totalMem: string;
    freeMem: string;
    nodeVersion: string;
    platform: string;
  };
  database: { status: string };
  timestamp: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
}
