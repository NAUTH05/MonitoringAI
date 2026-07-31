import { Request, Response, Router } from 'express';
import aicamPrisma from '../lib/aicamPrisma';
import { authenticate } from '../middleware/auth';

const router = Router();

export interface LicensePlateEventRaw {
  id: string;
  stream_id: string;
  task_name: string;
  event_time: Date;
  result: unknown;
  plate_text: string | null;
  vehicle_type: string | null;
  plate_color: string | null;
  confidence: number | null;
  image_path: string | null;
  thumbnail_path: string | null;
  created_at: Date;
}

// GET /api/license-plates/stats
router.get('/stats', authenticate, async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalPlatesRaw, todayPlatesRaw, vehicleTypesRaw, plateColorsRaw] = await Promise.all([
      aicamPrisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count FROM events WHERE plate_text IS NOT NULL AND plate_text != '';
      `,
      aicamPrisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count FROM events 
        WHERE plate_text IS NOT NULL AND plate_text != '' AND event_time >= ${today};
      `,
      aicamPrisma.$queryRaw<Array<{ vehicle_type: string; count: bigint }>>`
        SELECT vehicle_type, COUNT(*)::bigint as count 
        FROM events 
        WHERE plate_text IS NOT NULL AND plate_text != '' 
        GROUP BY vehicle_type 
        ORDER BY count DESC;
      `,
      aicamPrisma.$queryRaw<Array<{ plate_color: string; count: bigint }>>`
        SELECT plate_color, COUNT(*)::bigint as count 
        FROM events 
        WHERE plate_text IS NOT NULL AND plate_text != '' 
        GROUP BY plate_color 
        ORDER BY count DESC;
      `,
    ]);

    const totalPlates = Number(totalPlatesRaw[0]?.count || 0);
    const todayPlates = Number(todayPlatesRaw[0]?.count || 0);

    const vehicleTypes = vehicleTypesRaw.map((r) => ({
      type: r.vehicle_type || 'unknown',
      count: Number(r.count),
    }));

    const plateColors = plateColorsRaw.map((r) => ({
      color: r.plate_color || 'unknown',
      count: Number(r.count),
    }));

    res.json({
      success: true,
      data: {
        totalPlates,
        todayPlates,
        vehicleTypes,
        plateColors,
      },
    });
  } catch (err) {
    console.error('Error fetching license plate stats:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch license plate stats' });
  }
});

// GET /api/license-plates/export
router.get('/export', authenticate, async (req: Request, res: Response) => {
  try {
    const { search, vehicleType, plateColor, startDate, endDate } = req.query;

    const events = await aicamPrisma.$queryRaw<LicensePlateEventRaw[]>`
      SELECT id, stream_id, task_name, event_time, plate_text, vehicle_type, plate_color, confidence, image_path, thumbnail_path, created_at
      FROM events
      WHERE plate_text IS NOT NULL AND plate_text != ''
        AND (${search ? `%${search}%` : null}::text IS NULL OR LOWER(plate_text) LIKE LOWER(${search ? `%${search}%` : ''}))
        AND (${vehicleType || null}::text IS NULL OR vehicle_type = ${vehicleType || ''})
        AND (${plateColor || null}::text IS NULL OR plate_color = ${plateColor || ''})
        AND (${startDate ? new Date(startDate as string) : null}::timestamp IS NULL OR event_time >= ${startDate ? new Date(startDate as string) : new Date(0)})
        AND (${endDate ? new Date(endDate as string) : null}::timestamp IS NULL OR event_time <= ${endDate ? new Date(endDate as string) : new Date(0)})
      ORDER BY event_time DESC
      LIMIT 5000;
    `;

    // Convert to CSV string
    const headers = ['ID', 'Biển số xe', 'Loại xe', 'Màu biển', 'Độ tin cậy', 'Thời gian', 'Stream ID'];
    const rows = events.map((e) => [
      e.id,
      e.plate_text || '',
      e.vehicle_type || '',
      e.plate_color || '',
      e.confidence ? `${(e.confidence * 100).toFixed(1)}%` : '',
      new Date(e.event_time).toLocaleString('vi-VN'),
      e.stream_id || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${cell}"`).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bien_so_xe_export.csv"');
    res.send('\uFEFF' + csvContent); // BOM for Excel UTF-8
  } catch (err) {
    console.error('Error exporting license plates:', err);
    res.status(500).json({ success: false, message: 'Failed to export license plates' });
  }
});

// GET /api/license-plates
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const { page = '1', limit = '20', search, vehicleType, plateColor, startDate, endDate } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
    const offsetNum = (pageNum - 1) * limitNum;

    const searchParam = search && (search as string).trim() ? `%${(search as string).trim()}%` : null;
    const vehicleTypeParam = vehicleType && (vehicleType as string).trim() ? (vehicleType as string).trim() : null;
    const plateColorParam = plateColor && (plateColor as string).trim() ? (plateColor as string).trim() : null;
    const startDateParam = startDate ? new Date(startDate as string) : null;
    const endDateParam = endDate ? new Date(endDate as string) : null;

    const [events, countResult] = await Promise.all([
      aicamPrisma.$queryRaw<LicensePlateEventRaw[]>`
        SELECT id, stream_id, task_name, event_time, plate_text, vehicle_type, plate_color, confidence, image_path, thumbnail_path, created_at
        FROM events
        WHERE plate_text IS NOT NULL AND plate_text != ''
          AND (${searchParam}::text IS NULL OR LOWER(plate_text) LIKE LOWER(${searchParam}))
          AND (${vehicleTypeParam}::text IS NULL OR vehicle_type = ${vehicleTypeParam})
          AND (${plateColorParam}::text IS NULL OR plate_color = ${plateColorParam})
          AND (${startDateParam}::timestamp IS NULL OR event_time >= ${startDateParam})
          AND (${endDateParam}::timestamp IS NULL OR event_time <= ${endDateParam})
        ORDER BY event_time DESC
        LIMIT ${limitNum} OFFSET ${offsetNum};
      `,
      aicamPrisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count
        FROM events
        WHERE plate_text IS NOT NULL AND plate_text != ''
          AND (${searchParam}::text IS NULL OR LOWER(plate_text) LIKE LOWER(${searchParam}))
          AND (${vehicleTypeParam}::text IS NULL OR vehicle_type = ${vehicleTypeParam})
          AND (${plateColorParam}::text IS NULL OR plate_color = ${plateColorParam})
          AND (${startDateParam}::timestamp IS NULL OR event_time >= ${startDateParam})
          AND (${endDateParam}::timestamp IS NULL OR event_time <= ${endDateParam});
      `,
    ]);

    const total = Number(countResult[0]?.count || 0);

    const formattedEvents = events.map((e) => ({
      id: e.id,
      streamId: e.stream_id,
      taskName: e.task_name,
      eventTime: e.event_time,
      plateText: e.plate_text,
      vehicleType: e.vehicle_type,
      plateColor: e.plate_color,
      confidence: e.confidence,
      imagePath: e.image_path,
      thumbnailPath: e.thumbnail_path,
      createdAt: e.created_at,
    }));

    res.json({
      success: true,
      data: formattedEvents,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('Error fetching license plates:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch license plates' });
  }
});

export default router;
