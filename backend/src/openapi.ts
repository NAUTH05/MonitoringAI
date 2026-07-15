// Static OpenAPI 3.0 spec for the MonitoringAI backend.
// Hand-written (no swagger-jsdoc) to avoid annotating every route. Enough for demo/testing.

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'MonitoringAI API',
    version: '1.0.0',
    description:
      'API cho nền tảng giám sát Camera AI. Sự kiện và heartbeat từ camera dùng header `x-api-key`; các API quản trị dùng JWT Bearer.',
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local dev' }],
  tags: [
    { name: 'Auth' },
    { name: 'Cameras' },
    { name: 'Events' },
    { name: 'Modules' },
    { name: 'Reports' },
    { name: 'Health' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    schemas: {
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', example: 'admin@monitoring.com' },
          password: { type: 'string', example: 'Admin@123' },
        },
      },
      CreateEventRequest: {
        type: 'object',
        required: ['cameraId', 'eventType', 'confidence'],
        properties: {
          cameraId: { type: 'string', example: '665f0a1b2c3d4e5f6a7b8c9d' },
          eventType: {
            type: 'string',
            enum: ['INTRUSION', 'FIRE', 'SMOKE', 'PPE', 'FACE', 'VEHICLE'],
          },
          confidence: { type: 'number', minimum: 0, maximum: 1, example: 0.92 },
          imageUrl: { type: 'string', example: '/evidence/sample-intrusion.svg' },
          videoUrl: { type: 'string', example: '/evidence/TEST_CAM_1.mp4' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      CameraRequest: {
        type: 'object',
        required: ['name', 'location', 'rtspUrl'],
        properties: {
          name: { type: 'string', example: 'CAM-010' },
          location: { type: 'string', example: 'Loading Bay' },
          rtspUrl: { type: 'string', example: 'http://localhost:1984/api/stream.m3u8?src=cam1' },
          status: { type: 'string', enum: ['ONLINE', 'OFFLINE', 'ERROR'] },
        },
      },
      SuccessResponse: {
        type: 'object',
        properties: { success: { type: 'boolean' }, data: {} },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Đăng nhập, trả về JWT',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } },
        },
        responses: { 200: { description: 'OK, trả về token + user' }, 401: { description: 'Sai thông tin' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Thông tin user hiện tại',
        responses: { 200: { description: 'OK' }, 401: { description: 'Chưa xác thực' } },
      },
    },
    '/api/cameras': {
      get: {
        tags: ['Cameras'],
        summary: 'Danh sách camera',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ONLINE', 'OFFLINE', 'ERROR'] } },
        ],
        responses: { 200: { description: 'OK' } },
      },
      post: {
        tags: ['Cameras'],
        summary: 'Tạo camera (Admin/Manager)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CameraRequest' } } },
        },
        responses: { 201: { description: 'Created' }, 403: { description: 'Không đủ quyền' } },
      },
    },
    '/api/cameras/{id}': {
      get: {
        tags: ['Cameras'],
        summary: 'Chi tiết camera',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Không tìm thấy' } },
      },
      put: {
        tags: ['Cameras'],
        summary: 'Cập nhật camera (Admin/Manager)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CameraRequest' } } },
        },
        responses: { 200: { description: 'OK' } },
      },
      delete: {
        tags: ['Cameras'],
        summary: 'Xóa mềm camera (Admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/cameras/{id}/status': {
      patch: {
        tags: ['Cameras'],
        summary: 'Đổi trạng thái thủ công (Admin/Manager)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { status: { type: 'string', enum: ['ONLINE', 'OFFLINE', 'ERROR'] } },
              },
            },
          },
        },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/cameras/{id}/heartbeat': {
      post: {
        tags: ['Cameras'],
        summary: 'Camera AI báo sống (x-api-key). Đặt ONLINE + cập nhật lastHeartbeat.',
        security: [{ apiKeyAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 401: { description: 'Sai API key' }, 404: { description: 'Không tìm thấy' } },
      },
    },
    '/api/events': {
      get: {
        tags: ['Events'],
        summary: 'Danh sách sự kiện',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'cameraId', in: 'query', schema: { type: 'string' } },
          { name: 'isAlert', in: 'query', schema: { type: 'boolean' } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { 200: { description: 'OK' } },
      },
      post: {
        tags: ['Events'],
        summary: 'Camera AI đẩy sự kiện (x-api-key). confidence >= 0.8 sẽ tạo Alert.',
        security: [{ apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateEventRequest' } } },
        },
        responses: {
          201: { description: 'Created' },
          400: { description: 'Payload không hợp lệ' },
          401: { description: 'Sai/thiếu API key' },
          404: { description: 'Camera không tồn tại' },
        },
      },
    },
    '/api/events/{id}': {
      get: {
        tags: ['Events'],
        summary: 'Chi tiết sự kiện',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { description: 'Không tìm thấy' } },
      },
    },
    '/api/events/alerts/{alertId}/acknowledge': {
      patch: {
        tags: ['Events'],
        summary: 'Xác nhận cảnh báo',
        parameters: [{ name: 'alertId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/modules': {
      get: { tags: ['Modules'], summary: 'Danh sách AI module', responses: { 200: { description: 'OK' } } },
    },
    '/api/modules/camera/{cameraId}': {
      get: {
        tags: ['Modules'],
        summary: 'Module đã gán cho 1 camera',
        parameters: [{ name: 'cameraId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/modules/camera/{cameraId}/{moduleId}': {
      post: {
        tags: ['Modules'],
        summary: 'Gán module cho camera (Admin/Manager)',
        parameters: [
          { name: 'cameraId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'moduleId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 201: { description: 'Created' }, 409: { description: 'Đã gán' } },
      },
      delete: {
        tags: ['Modules'],
        summary: 'Gỡ module khỏi camera (Admin/Manager)',
        parameters: [
          { name: 'cameraId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'moduleId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/api/modules/camera/{cameraId}/{moduleId}/toggle': {
      patch: {
        tags: ['Modules'],
        summary: 'Bật/tắt module trên camera (Admin/Manager)',
        parameters: [
          { name: 'cameraId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'moduleId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'OK' }, 404: { description: 'Chưa gán' } },
      },
    },
    '/api/reports/dashboard': {
      get: { tags: ['Reports'], summary: 'Thống kê tổng hợp (dashboard)', responses: { 200: { description: 'OK' } } },
    },
    '/api/health': {
      get: { tags: ['Health'], summary: 'Tình trạng hệ thống', responses: { 200: { description: 'OK' } } },
    },
  },
} as const;
