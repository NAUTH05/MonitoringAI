import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatConfidence(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function getEventTypeColor(type: string): string {
  const colors: Record<string, string> = {
    INTRUSION: 'bg-red-500/20 text-red-400 border-red-500/30',
    FIRE: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    SMOKE: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    PPE: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    FACE: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    VEHICLE: 'bg-green-500/20 text-green-400 border-green-500/30',
  };
  return colors[type] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    ONLINE: 'bg-green-500/20 text-green-400 border-green-500/30',
    OFFLINE: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return colors[status] || 'bg-gray-500/20 text-gray-400';
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.9) return 'text-red-400';
  if (confidence >= 0.8) return 'text-orange-400';
  if (confidence >= 0.7) return 'text-yellow-400';
  return 'text-green-400';
}
