import type { OpenAPIObject } from '@nestjs/swagger';

type PathsObject = OpenAPIObject['paths'];
type SchemasObject = NonNullable<OpenAPIObject['components']>['schemas'];
type TagsObject = NonNullable<OpenAPIObject['tags']>;

export const MICROSERVICE_SWAGGER_TAGS: TagsObject = [
  {
    name: 'auth',
    description:
      'Platform IAM — Registration, Email Login, RS256 JWKS, Refresh Token Rotation & Tenant Switching',
  },
  {
    name: 'accounts',
    description: 'Platform Account Profile & Self-Service Account Management',
  },
  {
    name: 'tenants',
    description:
      'Platform Multi-Tenant Store Lifecycle, Memberships, Roles & Invitations',
  },
  {
    name: 'branches',
    description: 'Platform Store Branches (Tenant-Scoped)',
  },
  {
    name: 'health',
    description:
      'Platform Liveness & Readiness Probes (/health, /health/live, /health/ready)',
  },
  {
    name: 'Inventory — Stock & Warehouses',
    description:
      'Inventory Service — Branch Stock Receipts, Warehouses & Decimal(12,3) Stock Balances',
  },
  {
    name: 'Inventory — Internal Reservations',
    description:
      'Inventory Service (East-West Internal API) — Synchronous Branch & Warehouse Stock Reservations (ADR-0012)',
  },
  {
    name: 'Sales — Orders & Checkouts',
    description:
      'Sales Service — POS Orders, Stateful Warehouse Checkout Machine & Timeout Recovery (ADR-0012)',
  },
  {
    name: 'Insight — Audit & Analytics',
    description:
      'Insight Service — Cross-Service Audit Logs & Daily Sales Revenue Projections',
  },
  {
    name: 'Catalog — Categories, Brands, Products, Variants & Pricing',
    description:
      'Catalog Service (M1 Core) — Categories, Brands, Attributes, Products, Variants, Barcodes, Units & Price Lists (ADR-0013)',
  },
  {
    name: 'Microservices — Health & Readiness',
    description:
      'Health & Readiness Endpoints across Inventory, Sales, Insight, Catalog, Customer, Finance & Integration',
  },
];

export const MICROSERVICE_SWAGGER_SCHEMAS: SchemasObject = {
  ErrorEnvelopeRes: {
    type: 'object',
    required: ['statusCode', 'errorCode', 'message', 'timestamp', 'traceId'],
    properties: {
      statusCode: { type: 'integer', example: 409 },
      errorCode: { type: 'string', example: 'INVENTORY_OUT_OF_STOCK' },
      message: {
        type: 'string',
        example: 'Insufficient available stock for reservation',
      },
      details: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
      timestamp: {
        type: 'string',
        format: 'date-time',
        example: '2026-10-27T08:30:00.000Z',
      },
      path: { type: 'string', example: '/internal/v1/reservations' },
      requestId: {
        type: 'string',
        example: 'req-9c81b3e0-1234-4a56-89ab-cdef01234567',
      },
      traceId: {
        type: 'string',
        example: 'req-9c81b3e0-1234-4a56-89ab-cdef01234567',
      },
    },
  },
  ServiceHealthRes: {
    type: 'object',
    required: ['status', 'service'],
    properties: {
      status: { type: 'string', enum: ['ok', 'degraded'], example: 'ok' },
      service: { type: 'string', example: 'inventory' },
      checks: {
        type: 'object',
        additionalProperties: { type: 'string' },
        example: { database: 'up' },
      },
    },
  },
  StockReceiptLineDto: {
    type: 'object',
    required: ['sku', 'name', 'quantity'],
    properties: {
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M', maxLength: 64 },
      name: {
        type: 'string',
        example: 'Classic Black T-Shirt (M)',
        maxLength: 200,
      },
      quantity: { type: 'integer', minimum: 1, maximum: 100000, example: 50 },
    },
  },
  StockReceiptReqDto: {
    type: 'object',
    required: ['branchId', 'items'],
    properties: {
      branchId: {
        type: 'string',
        format: 'uuid',
        example: '11111111-1111-4111-8111-111111111111',
      },
      note: {
        type: 'string',
        maxLength: 500,
        example: 'Initial supplier delivery PO-2026-001',
      },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { $ref: '#/components/schemas/StockReceiptLineDto' },
      },
    },
  },
  StockRes: {
    type: 'object',
    required: ['branchId', 'sku', 'name', 'onHand', 'reserved', 'available'],
    properties: {
      branchId: {
        type: 'string',
        format: 'uuid',
        example: '11111111-1111-4111-8111-111111111111',
      },
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M' },
      name: { type: 'string', example: 'Classic Black T-Shirt (M)' },
      onHand: { type: 'integer', example: 50 },
      reserved: { type: 'integer', example: 2 },
      available: { type: 'integer', example: 48 },
    },
  },
  PageStockRes: {
    type: 'object',
    required: ['items', 'page', 'limit', 'total'],
    properties: {
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/StockRes' },
      },
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      total: { type: 'integer', example: 1 },
    },
  },
  CreateWarehouseDto: {
    type: 'object',
    required: ['code', 'name'],
    properties: {
      branchId: {
        type: 'string',
        format: 'uuid',
        example: '11111111-1111-4111-8111-111111111111',
      },
      code: { type: 'string', maxLength: 32, example: 'WH-HCM-01' },
      name: {
        type: 'string',
        maxLength: 120,
        example: 'Ho Chi Minh Central Warehouse',
      },
    },
  },
  WarehouseRes: {
    type: 'object',
    required: ['id', 'tenantId', 'code', 'name', 'isActive', 'createdAt'],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        example: '22222222-2222-4222-8222-222222222222',
      },
      tenantId: {
        type: 'string',
        format: 'uuid',
        example: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      branchId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: '11111111-1111-4111-8111-111111111111',
      },
      code: { type: 'string', example: 'WH-HCM-01' },
      name: { type: 'string', example: 'Ho Chi Minh Central Warehouse' },
      isActive: { type: 'boolean', example: true },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  ReceiveStockBalanceDto: {
    type: 'object',
    required: ['warehouseId', 'variantId', 'sku', 'qty'],
    properties: {
      warehouseId: {
        type: 'string',
        format: 'uuid',
        example: '22222222-2222-4222-8222-222222222222',
      },
      variantId: {
        type: 'string',
        format: 'uuid',
        example: '33333333-3333-4333-8333-333333333333',
      },
      sku: { type: 'string', maxLength: 64, example: 'SKU-TSHIRT-BLK-M' },
      qty: {
        type: 'string',
        example: '25.000',
        description: 'Positive decimal(12,3) quantity string',
      },
    },
  },
  StockBalanceRes: {
    type: 'object',
    required: [
      'id',
      'warehouseId',
      'variantId',
      'sku',
      'qtyOnHand',
      'qtyReserved',
      'qtyAvailable',
      'version',
    ],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        example: '44444444-4444-4444-8444-444444444444',
      },
      warehouseId: {
        type: 'string',
        format: 'uuid',
        example: '22222222-2222-4222-8222-222222222222',
      },
      variantId: {
        type: 'string',
        format: 'uuid',
        example: '33333333-3333-4333-8333-333333333333',
      },
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M' },
      qtyOnHand: { type: 'string', example: '25.000' },
      qtyReserved: { type: 'string', example: '2.000' },
      qtyAvailable: { type: 'string', example: '23.000' },
      version: { type: 'integer', example: 2 },
    },
  },
  ReserveStockLineDto: {
    type: 'object',
    required: ['sku', 'quantity'],
    properties: {
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M' },
      quantity: { type: 'integer', minimum: 1, maximum: 10000, example: 2 },
    },
  },
  ReserveStockReqDto: {
    type: 'object',
    required: ['orderId', 'branchId', 'items'],
    properties: {
      orderId: {
        type: 'string',
        format: 'uuid',
        example: '55555555-5555-4555-8555-555555555555',
      },
      branchId: {
        type: 'string',
        format: 'uuid',
        example: '11111111-1111-4111-8111-111111111111',
      },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/ReserveStockLineDto' },
      },
    },
  },
  StockReservationRes: {
    type: 'object',
    required: ['orderId', 'branchId', 'items', 'reservedAt'],
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      branchId: { type: 'string', format: 'uuid' },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/ReserveStockLineDto' },
      },
      reservedAt: { type: 'string', format: 'date-time' },
    },
  },
  WarehouseReservationItemDto: {
    type: 'object',
    required: ['variantId', 'sku', 'qty'],
    properties: {
      variantId: {
        type: 'string',
        format: 'uuid',
        example: '33333333-3333-4333-8333-333333333333',
      },
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M' },
      qty: { type: 'string', example: '2.000' },
    },
  },
  CreateWarehouseReservationDto: {
    type: 'object',
    required: ['orderId', 'warehouseId', 'items'],
    properties: {
      orderId: {
        type: 'string',
        format: 'uuid',
        example: '55555555-5555-4555-8555-555555555555',
      },
      warehouseId: {
        type: 'string',
        format: 'uuid',
        example: '22222222-2222-4222-8222-222222222222',
      },
      ttlSeconds: {
        type: 'integer',
        minimum: 30,
        maximum: 86400,
        default: 900,
        example: 900,
      },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/WarehouseReservationItemDto' },
      },
    },
  },
  ReleaseWarehouseReservationDto: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        maxLength: 160,
        example: 'Customer cancelled checkout',
      },
    },
  },
  WarehouseReservationRes: {
    type: 'object',
    required: [
      'reservationId',
      'tenantId',
      'orderId',
      'warehouseId',
      'status',
      'expiresAt',
      'items',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      reservationId: {
        type: 'string',
        format: 'uuid',
        example: '66666666-6666-4666-8666-666666666666',
      },
      tenantId: { type: 'string', format: 'uuid' },
      orderId: { type: 'string', format: 'uuid' },
      warehouseId: { type: 'string', format: 'uuid' },
      status: {
        type: 'string',
        enum: ['RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED'],
        example: 'RESERVED',
      },
      expiresAt: { type: 'string', format: 'date-time' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            variantId: { type: 'string', format: 'uuid' },
            sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M' },
            qtyReserved: { type: 'string', example: '2.000' },
          },
        },
      },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  OrderLineReqDto: {
    type: 'object',
    required: ['sku', 'name', 'quantity', 'unitPrice'],
    properties: {
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M', maxLength: 64 },
      name: {
        type: 'string',
        example: 'Classic Black T-Shirt (M)',
        maxLength: 200,
      },
      quantity: { type: 'integer', minimum: 1, maximum: 10000, example: 2 },
      unitPrice: {
        type: 'integer',
        minimum: 0,
        maximum: 1000000000,
        example: 150000,
        description: 'Unit price in integer VND',
      },
    },
  },
  CreateOrderReqDto: {
    type: 'object',
    required: ['branchId', 'paymentMethod', 'items'],
    properties: {
      branchId: {
        type: 'string',
        format: 'uuid',
        example: '11111111-1111-4111-8111-111111111111',
      },
      paymentMethod: {
        type: 'string',
        enum: ['cash', 'card', 'transfer', 'cod'],
        example: 'cash',
      },
      customerName: {
        type: 'string',
        maxLength: 150,
        example: 'Nguyen Van A',
      },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: { $ref: '#/components/schemas/OrderLineReqDto' },
      },
    },
  },
  OrderLineRes: {
    type: 'object',
    required: ['sku', 'name', 'quantity', 'unitPrice', 'lineTotal'],
    properties: {
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M' },
      name: { type: 'string', example: 'Classic Black T-Shirt (M)' },
      quantity: { type: 'integer', example: 2 },
      unitPrice: { type: 'integer', example: 150000 },
      lineTotal: { type: 'integer', example: 300000 },
    },
  },
  OrderRes: {
    type: 'object',
    required: [
      'id',
      'branchId',
      'cashierAccountId',
      'paymentMethod',
      'totalAmount',
      'items',
      'createdAt',
    ],
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        example: '77777777-7777-4777-8777-777777777777',
      },
      branchId: { type: 'string', format: 'uuid' },
      cashierAccountId: { type: 'string', format: 'uuid' },
      customerName: { type: 'string', nullable: true, example: 'Nguyen Van A' },
      paymentMethod: {
        type: 'string',
        enum: ['cash', 'card', 'transfer', 'cod'],
        example: 'cash',
      },
      totalAmount: { type: 'integer', example: 300000 },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/OrderLineRes' },
      },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PageOrderRes: {
    type: 'object',
    required: ['items', 'page', 'limit', 'total'],
    properties: {
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/OrderRes' },
      },
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 10 },
      total: { type: 'integer', example: 1 },
    },
  },
  CheckoutLineReqDto: {
    type: 'object',
    required: ['variantId', 'sku', 'name', 'qty', 'unitPrice'],
    properties: {
      variantId: {
        type: 'string',
        format: 'uuid',
        example: '33333333-3333-4333-8333-333333333333',
      },
      sku: { type: 'string', example: 'SKU-TSHIRT-BLK-M', maxLength: 64 },
      name: {
        type: 'string',
        example: 'Classic Black T-Shirt (M)',
        maxLength: 160,
      },
      qty: {
        type: 'string',
        example: '2.000',
        description: 'Positive decimal(12,3) quantity string',
      },
      unitPrice: {
        type: 'integer',
        minimum: 0,
        maximum: 1000000000,
        example: 150000,
      },
    },
  },
  CreateCheckoutReqDto: {
    type: 'object',
    required: ['branchId', 'warehouseId', 'paymentMethod', 'items'],
    properties: {
      branchId: {
        type: 'string',
        format: 'uuid',
        example: '11111111-1111-4111-8111-111111111111',
      },
      warehouseId: {
        type: 'string',
        format: 'uuid',
        example: '22222222-2222-4222-8222-222222222222',
      },
      paymentMethod: {
        type: 'string',
        enum: ['cash', 'card', 'transfer', 'cod'],
        example: 'card',
      },
      customerName: {
        type: 'string',
        maxLength: 120,
        example: 'Nguyen Van A',
      },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: { $ref: '#/components/schemas/CheckoutLineReqDto' },
      },
    },
  },
  CheckoutWorkflowResponse: {
    type: 'object',
    required: [
      'checkoutId',
      'orderId',
      'warehouseId',
      'branchId',
      'status',
      'totalAmount',
      'items',
      'replayed',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      checkoutId: {
        type: 'string',
        format: 'uuid',
        example: '88888888-8888-4888-8888-888888888888',
      },
      orderId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: '77777777-7777-4777-8777-777777777777',
      },
      reservationId: {
        type: 'string',
        format: 'uuid',
        nullable: true,
        example: '66666666-6666-4666-8666-666666666666',
      },
      warehouseId: { type: 'string', format: 'uuid' },
      branchId: { type: 'string', format: 'uuid' },
      status: {
        type: 'string',
        enum: [
          'PENDING_STOCK',
          'RESERVING',
          'STOCK_RESERVED',
          'CONFIRMED',
          'RECOVERY_PENDING',
          'CANCELLED',
          'FAILED',
        ],
        example: 'CONFIRMED',
      },
      totalAmount: { type: 'integer', example: 300000 },
      failureReason: { type: 'string', nullable: true, example: null },
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/CheckoutLineReqDto' },
      },
      replayed: { type: 'boolean', example: false },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  AuditLogRes: {
    type: 'object',
    required: ['eventId', 'type', 'producer', 'occurredAt', 'payload'],
    properties: {
      eventId: { type: 'string', format: 'uuid' },
      type: { type: 'string', example: 'sales.order.placed' },
      producer: { type: 'string', example: 'sales' },
      actorAccountId: { type: 'string', format: 'uuid', nullable: true },
      occurredAt: { type: 'string', format: 'date-time' },
      payload: { type: 'object', additionalProperties: true },
    },
  },
  PageAuditLogRes: {
    type: 'object',
    required: ['items', 'page', 'limit', 'total'],
    properties: {
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/AuditLogRes' },
      },
      page: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 10 },
      total: { type: 'integer', example: 1 },
    },
  },
  DailySalesSummaryRowRes: {
    type: 'object',
    required: ['day', 'branchId', 'orderCount', 'revenueAmount'],
    properties: {
      day: { type: 'string', example: '2026-10-27' },
      branchId: { type: 'string', format: 'uuid' },
      orderCount: { type: 'integer', example: 12 },
      revenueAmount: { type: 'integer', example: 4500000 },
    },
  },
  DailySalesSummaryRes: {
    type: 'object',
    required: ['from', 'to', 'totals', 'days'],
    properties: {
      from: { type: 'string', example: '2026-10-20' },
      to: { type: 'string', example: '2026-10-27' },
      branchId: { type: 'string', format: 'uuid', nullable: true },
      totals: {
        type: 'object',
        properties: {
          orderCount: { type: 'integer', example: 42 },
          revenueAmount: { type: 'integer', example: 15800000 },
        },
      },
      days: {
        type: 'array',
        items: { $ref: '#/components/schemas/DailySalesSummaryRowRes' },
      },
    },
  },
};

export const MICROSERVICE_SWAGGER_PATHS: PathsObject = {
  // =========================================================================
  // INVENTORY SERVICE — STOCK & WAREHOUSES
  // =========================================================================
  '/inventory/api/v1/stock-receipts': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Receive branch stock (purchase receipt)',
      description:
        'Increments branch on-hand stock for each line item and writes a PURCHASE_RECEIPT movement. Direct service path: `POST /api/v1/stock-receipts` (Inventory :3000).',
      operationId: 'InventoryStockController_receive',
      security: [{ bearer: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/StockReceiptReqDto' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Updated branch stock rows',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/StockRes' },
              },
            },
          },
        },
        '422': {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelopeRes' },
            },
          },
        },
      },
    },
  },
  '/inventory/api/v1/stock': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List branch stock levels',
      description:
        'Returns paginated branch stock rows with onHand, reserved, and available quantities. Direct service path: `GET /api/v1/stock` (Inventory :3000).',
      operationId: 'InventoryStockController_list',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'page',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 1, minimum: 1 },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        },
        {
          name: 'branchId',
          in: 'query',
          required: false,
          description: 'Optional branch UUID filter',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Paginated branch stock levels',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PageStockRes' },
            },
          },
        },
      },
    },
  },
  '/inventory/api/v1/warehouses': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Create a warehouse',
      description:
        'Creates a tenant-scoped warehouse for decimal(12,3) stock balances and reservations. Direct service path: `POST /api/v1/warehouses` (Inventory :3000).',
      operationId: 'InventoryStockController_createWarehouse',
      security: [{ bearer: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateWarehouseDto' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Created warehouse record',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WarehouseRes' },
            },
          },
        },
      },
    },
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List tenant warehouses',
      description:
        'Lists all warehouses belonging to the current tenant. Direct service path: `GET /api/v1/warehouses` (Inventory :3000).',
      operationId: 'InventoryStockController_listWarehouses',
      security: [{ bearer: [] }],
      responses: {
        '200': {
          description: 'List of tenant warehouses',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/WarehouseRes' },
              },
            },
          },
        },
      },
    },
  },
  '/inventory/api/v1/stock-balances/receipts': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Receive warehouse stock balance (decimal 12,3)',
      description:
        'Increments decimal(12,3) warehouse stock balance (`qty_on_hand`) for a product variant and emits `inventory.stock.changed` via outbox. Direct service path: `POST /api/v1/stock-balances/receipts` (Inventory :3000).',
      operationId: 'InventoryStockController_receiveStockBalance',
      security: [{ bearer: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ReceiveStockBalanceDto' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Updated warehouse stock balance',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StockBalanceRes' },
            },
          },
        },
      },
    },
  },
  '/inventory/api/v1/stock-balances': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List warehouse stock balances',
      description:
        'Returns decimal(12,3) `qtyOnHand`, `qtyReserved`, and `qtyAvailable` across warehouses. Direct service path: `GET /api/v1/stock-balances` (Inventory :3000).',
      operationId: 'InventoryStockController_listStockBalances',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'warehouseId',
          in: 'query',
          required: false,
          description: 'Optional warehouse UUID filter',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'List of warehouse stock balances',
          content: {
            'application/json': {
              schema: {
                type: 'array',
                items: { $ref: '#/components/schemas/StockBalanceRes' },
              },
            },
          },
        },
      },
    },
  },

  // =========================================================================
  // INVENTORY SERVICE — INTERNAL RESERVATIONS (EAST-WEST)
  // =========================================================================
  '/internal/v1/reservations': {
    post: {
      tags: ['Inventory — Internal Reservations'],
      summary:
        '[Internal East-West] Create or replay a warehouse stock reservation',
      description:
        'Called synchronously by Sales during checkout. Acquires `FOR UPDATE` row locks in deterministic `(warehouse_id, variant_id)` order, checks `qty_on_hand - qty_reserved >= qty`, increments `qty_reserved`, and writes `inventory.reservation.confirmed` to outbox. Never exposed on public KrakenD.',
      operationId: 'WarehouseReservationsController_create',
      parameters: [
        {
          name: 'X-Tenant-Id',
          in: 'header',
          required: true,
          description: 'Tenant UUID for RLS isolation',
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          description: 'Deterministic UUID per checkout attempt',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/CreateWarehouseReservationDto',
            },
          },
        },
      },
      responses: {
        '201': {
          description: 'Warehouse reservation created',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WarehouseReservationRes' },
            },
          },
        },
        '200': {
          description: 'Idempotent replay of existing reservation',
          headers: {
            'Idempotency-Replayed': {
              schema: { type: 'string', example: 'true' },
            },
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WarehouseReservationRes' },
            },
          },
        },
        '409': {
          description: 'Out of stock or idempotency payload mismatch',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelopeRes' },
            },
          },
        },
      },
    },
  },
  '/internal/v1/reservations/{reservationId}': {
    get: {
      tags: ['Inventory — Internal Reservations'],
      summary: '[Internal East-West] Inspect warehouse reservation by ID',
      description:
        'Used by Sales timeout recovery to inspect a reservation state.',
      operationId: 'WarehouseReservationsController_getById',
      parameters: [
        {
          name: 'reservationId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'X-Tenant-Id',
          in: 'header',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Warehouse reservation details',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WarehouseReservationRes' },
            },
          },
        },
      },
    },
  },
  '/internal/v1/reservations/{reservationId}/commit': {
    post: {
      tags: ['Inventory — Internal Reservations'],
      summary: '[Internal East-West] Commit a reserved warehouse stock hold',
      description:
        'Transitions a `RESERVED` hold to `COMMITTED` and deducts both `qty_on_hand` and `qty_reserved`.',
      operationId: 'WarehouseReservationsController_commit',
      parameters: [
        {
          name: 'reservationId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'X-Tenant-Id',
          in: 'header',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Reservation committed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WarehouseReservationRes' },
            },
          },
        },
      },
    },
  },
  '/internal/v1/reservations/{reservationId}/release': {
    post: {
      tags: ['Inventory — Internal Reservations'],
      summary: '[Internal East-West] Release a warehouse stock reservation',
      description:
        'Idempotently transitions a `RESERVED` hold to `RELEASED` and restores `qty_reserved`.',
      operationId: 'WarehouseReservationsController_release',
      parameters: [
        {
          name: 'reservationId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'X-Tenant-Id',
          in: 'header',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/ReleaseWarehouseReservationDto',
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Reservation released',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WarehouseReservationRes' },
            },
          },
        },
      },
    },
  },
  '/internal/reservations': {
    post: {
      tags: ['Inventory — Internal Reservations'],
      summary: '[Internal East-West] Reserve branch stock for POS order',
      description:
        'Holds branch stock for a POS order (`POST /sales/api/v1/orders`). Returns 201 on new hold, 200 on replay, or 409 on stock shortage.',
      operationId: 'ReservationsController_reserve',
      security: [{ bearer: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ReserveStockReqDto' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Branch stock reserved',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StockReservationRes' },
            },
          },
        },
        '409': {
          description: 'Out of stock or reservation mismatch',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelopeRes' },
            },
          },
        },
      },
    },
  },
  '/internal/reservations/{orderId}': {
    delete: {
      tags: ['Inventory — Internal Reservations'],
      summary:
        '[Internal East-West] Release branch stock reservation for an order',
      description:
        'Compensating action called by Sales if order persistence fails after branch stock reservation.',
      operationId: 'ReservationsController_release',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'orderId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '204': {
          description: 'Branch stock reservation released',
        },
      },
    },
  },

  // =========================================================================
  // SALES SERVICE — ORDERS & CHECKOUT WORKFLOW
  // =========================================================================
  '/sales/api/v1/orders': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Create a sales order (POS / branch checkout)',
      description:
        'Reserves branch stock synchronously via Inventory, persists the order and `sales.order.placed` outbox event, and supports idempotent replay via `Idempotency-Key`. Direct service path: `POST /api/v1/orders` (Sales :3000).',
      operationId: 'OrdersController_create',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          description: 'A UUID per sale attempt',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateOrderReqDto' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Order created and branch stock reserved',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderRes' },
            },
          },
        },
        '200': {
          description: 'Idempotent replay of an existing order',
          headers: {
            'Idempotency-Replayed': {
              schema: { type: 'string', example: 'true' },
            },
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderRes' },
            },
          },
        },
        '409': {
          description: 'Out of stock or idempotency key mismatch',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelopeRes' },
            },
          },
        },
      },
    },
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'List sales orders',
      description:
        'Returns paginated sales orders for the current tenant. Direct service path: `GET /api/v1/orders` (Sales :3000).',
      operationId: 'OrdersController_list',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'page',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 1, minimum: 1 },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
        },
        {
          name: 'branchId',
          in: 'query',
          required: false,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Paginated sales orders',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PageOrderRes' },
            },
          },
        },
      },
    },
  },
  '/sales/api/v1/orders/{id}': {
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Get sales order by ID',
      description:
        'Returns a single sales order with its line items. Direct service path: `GET /api/v1/orders/{id}` (Sales :3000).',
      operationId: 'OrdersController_get',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Sales order details',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderRes' },
            },
          },
        },
        '404': {
          description: 'Order not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelopeRes' },
            },
          },
        },
      },
    },
  },
  '/sales/api/v1/orders/checkouts': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Execute warehouse-backed checkout workflow (ADR-0012)',
      description:
        'Runs the stateful checkout machine (`PENDING_STOCK -> RESERVING -> STOCK_RESERVED -> CONFIRMED`) against Inventory warehouse reservations. Transitions to `RECOVERY_PENDING` on East-West timeout. Direct service path: `POST /api/v1/orders/checkouts` (Sales :3000).',
      operationId: 'OrdersController_checkout',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          description: 'A UUID per checkout attempt',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/CreateCheckoutReqDto' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Checkout workflow created and executed',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CheckoutWorkflowResponse',
              },
            },
          },
        },
        '200': {
          description: 'Idempotent replay of existing checkout workflow',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CheckoutWorkflowResponse',
              },
            },
          },
        },
      },
    },
  },
  '/sales/api/v1/orders/checkouts/{id}': {
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Get checkout workflow status by ID',
      description:
        'Returns current state machine status, reservationId, and orderId. Direct service path: `GET /api/v1/orders/checkouts/{id}` (Sales :3000).',
      operationId: 'OrdersController_getCheckout',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Checkout workflow status',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CheckoutWorkflowResponse',
              },
            },
          },
        },
      },
    },
  },
  '/sales/api/v1/orders/checkouts/{id}/recover': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Recover a timed-out checkout workflow (RECOVERY_PENDING)',
      description:
        'Replays the deterministic `Idempotency-Key` against Inventory to reconcile a `RECOVERY_PENDING` checkout into `CONFIRMED` or `FAILED`. Direct service path: `POST /api/v1/orders/checkouts/{id}/recover` (Sales :3000).',
      operationId: 'OrdersController_recoverCheckout',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Recovered checkout workflow state',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CheckoutWorkflowResponse',
              },
            },
          },
        },
      },
    },
  },
  '/sales/api/v1/orders/checkouts/{id}/cancel': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Cancel a checkout workflow and release reserved stock',
      description:
        'Releases any held warehouse reservation in Inventory and transitions the checkout workflow to `CANCELLED`. Direct service path: `POST /api/v1/orders/checkouts/{id}/cancel` (Sales :3000).',
      operationId: 'OrdersController_cancelCheckout',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Cancelled checkout workflow state',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CheckoutWorkflowResponse',
              },
            },
          },
        },
      },
    },
  },

  // =========================================================================
  // INSIGHT SERVICE — AUDIT LOGS & DAILY SALES SUMMARY
  // =========================================================================
  '/insight/api/v1/audit-logs': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'List tenant audit logs',
      description:
        'Returns paginated audit events ingested asynchronously from Platform, Inventory, and Sales via EventBridge/SQS. Direct service path: `GET /api/v1/audit-logs` (Insight :3000).',
      operationId: 'InsightController_auditLogs',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'page',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 1, minimum: 1 },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
        },
        {
          name: 'type',
          in: 'query',
          required: false,
          description:
            'Exact domain event type (e.g. platform.account.logged_in, sales.order.placed)',
          schema: { type: 'string' },
        },
      ],
      responses: {
        '200': {
          description: 'Paginated audit log entries',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PageAuditLogRes' },
            },
          },
        },
      },
    },
  },
  '/insight/api/v1/sales-summary/daily': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get daily sales summary',
      description:
        'Returns aggregated daily order counts and revenue (VND) projected from `sales.order.placed` events. Direct service path: `GET /api/v1/sales-summary/daily` (Insight :3000).',
      operationId: 'InsightController_dailySales',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'from',
          in: 'query',
          required: false,
          description: 'Start date (YYYY-MM-DD, inclusive)',
          schema: { type: 'string', example: '2026-10-20' },
        },
        {
          name: 'to',
          in: 'query',
          required: false,
          description: 'End date (YYYY-MM-DD, inclusive)',
          schema: { type: 'string', example: '2026-10-27' },
        },
        {
          name: 'branchId',
          in: 'query',
          required: false,
          description: 'Optional branch UUID filter',
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': {
          description: 'Daily sales summary report',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/DailySalesSummaryRes' },
            },
          },
        },
      },
    },
  },

  // =========================================================================
  // CATALOG SERVICE — M1 CORE (Categories, Brands, Attributes, Products, Variants, Pricing)
  // =========================================================================
  '/catalog/api/v1/categories': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Create a category (up to 3 levels deep)',
      operationId: 'CatalogCategories_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Category created' } },
    },
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'List or search categories for the current tenant',
      operationId: 'CatalogCategories_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Categories retrieved' } },
    },
  },
  '/catalog/api/v1/categories/tree': {
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Get the hierarchical category tree (up to 3 levels)',
      operationId: 'CatalogCategories_tree',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Category tree retrieved' } },
    },
  },
  '/catalog/api/v1/categories/{id}': {
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Get a category by ID',
      operationId: 'CatalogCategories_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Category retrieved' } },
    },
    patch: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Update category name, slug, sortOrder, or status',
      operationId: 'CatalogCategories_update',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Category updated' } },
    },
    delete: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary:
        'Safely deactivate a category (fails with 409 CATEGORY_IN_USE if referenced)',
      operationId: 'CatalogCategories_deactivate',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Category deactivated' } },
    },
  },
  '/catalog/api/v1/categories/{id}/reparent': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary:
        'Reparent a category and its subtree with cycle and max-depth (3) validation',
      operationId: 'CatalogCategories_reparent',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Category reparented' } },
    },
  },
  '/catalog/api/v1/brands': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Create a brand',
      operationId: 'CatalogBrands_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Brand created' } },
    },
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'List or search brands for the current tenant',
      operationId: 'CatalogBrands_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Brands retrieved' } },
    },
  },
  '/catalog/api/v1/brands/{id}': {
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Get a brand by ID',
      operationId: 'CatalogBrands_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Brand retrieved' } },
    },
    patch: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Update a brand',
      operationId: 'CatalogBrands_update',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Brand updated' } },
    },
    delete: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Deactivate a brand (preserves historical product references)',
      operationId: 'CatalogBrands_deactivate',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Brand deactivated' } },
    },
  },
  '/catalog/api/v1/attributes': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Create a variant attribute (e.g., Color, Size)',
      operationId: 'CatalogAttributes_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Attribute created' } },
    },
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'List attributes and their values for the current tenant',
      operationId: 'CatalogAttributes_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Attributes retrieved' } },
    },
  },
  '/catalog/api/v1/attributes/{id}/values': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Add a value to an attribute',
      operationId: 'CatalogAttributes_createValue',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '201': { description: 'Attribute value created' } },
    },
  },
  '/catalog/api/v1/products': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary:
        'Create a product with optional default variant and unit conversions',
      operationId: 'CatalogProducts_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Product created' } },
    },
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary:
        'List and search products (supports offset and keyset cursor pagination)',
      operationId: 'CatalogProducts_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Products retrieved' } },
    },
  },
  '/catalog/api/v1/products/lookup': {
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Fast exact lookup by SKU or barcode (POS scanner path)',
      operationId: 'CatalogProducts_lookup',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Variant and product matched' } },
    },
  },
  '/catalog/api/v1/products/{id}': {
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary:
        'Get a product with its variants, attributes, and unit conversions',
      operationId: 'CatalogProducts_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Product retrieved' } },
    },
    patch: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Update product master data (supports optimistic locking)',
      operationId: 'CatalogProducts_update',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Product updated' } },
    },
    delete: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Soft-delete a product and deactivate its variants',
      operationId: 'CatalogProducts_delete',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Product soft-deleted' } },
    },
  },
  '/catalog/api/v1/products/{id}/variants': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Create a single variant for a product',
      operationId: 'CatalogProducts_createVariant',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '201': { description: 'Variant created' } },
    },
  },
  '/catalog/api/v1/products/{id}/variants/generate': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary:
        'Generate Cartesian product of variants from attribute axes (capped at 100)',
      operationId: 'CatalogProducts_generateVariants',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '201': { description: 'Variants generated atomically' } },
    },
  },
  '/catalog/api/v1/variants/{id}': {
    patch: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Update a variant (SKU, barcode, basePrice, attributes)',
      operationId: 'CatalogVariants_update',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Variant updated' } },
    },
  },
  '/catalog/api/v1/variants/{id}/status': {
    patch: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Transition a variant status (ACTIVE, INACTIVE, ARCHIVED)',
      operationId: 'CatalogVariants_updateStatus',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Variant status updated' } },
    },
  },
  '/catalog/api/v1/variants/{id}/price': {
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary:
        'Deterministically resolve the active sellable price for a variant',
      operationId: 'CatalogPricing_resolvePrice',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Variant price resolved' } },
    },
  },
  '/catalog/api/v1/price-lists': {
    post: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Create a catalog price list',
      operationId: 'CatalogPricing_createPriceList',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Price list created' } },
    },
    get: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'List catalog price lists for the current tenant',
      operationId: 'CatalogPricing_listPriceLists',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Price lists retrieved' } },
    },
  },
  '/catalog/api/v1/price-lists/{id}/items': {
    put: {
      tags: ['Catalog — Categories, Brands, Products, Variants & Pricing'],
      summary: 'Atomically upsert variant prices within a price list',
      operationId: 'CatalogPricing_upsertPriceListItems',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Price list items upserted' } },
    },
  },

  // =========================================================================
  // MICROSERVICES — HEALTH & READINESS PROBES
  // =========================================================================
  '/inventory/health': {
    get: {
      tags: ['Microservices — Health & Readiness'],
      summary: 'Inventory service health probe',
      operationId: 'InventoryHealth_live',
      responses: {
        '200': {
          description: 'Inventory is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceHealthRes' },
            },
          },
        },
      },
    },
  },
  '/sales/health': {
    get: {
      tags: ['Microservices — Health & Readiness'],
      summary: 'Sales service health probe',
      operationId: 'SalesHealth_live',
      responses: {
        '200': {
          description: 'Sales is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceHealthRes' },
            },
          },
        },
      },
    },
  },
  '/insight/health': {
    get: {
      tags: ['Microservices — Health & Readiness'],
      summary: 'Insight service health probe',
      operationId: 'InsightHealth_live',
      responses: {
        '200': {
          description: 'Insight is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceHealthRes' },
            },
          },
        },
      },
    },
  },
  '/catalog/health': {
    get: {
      tags: ['Microservices — Health & Readiness'],
      summary: 'Catalog service health probe',
      operationId: 'CatalogHealth_live',
      responses: {
        '200': {
          description: 'Catalog is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceHealthRes' },
            },
          },
        },
      },
    },
  },
  '/customer/health': {
    get: {
      tags: ['Microservices — Health & Readiness'],
      summary: 'Customer service health probe',
      operationId: 'CustomerHealth_live',
      responses: {
        '200': {
          description: 'Customer is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceHealthRes' },
            },
          },
        },
      },
    },
  },
  '/finance/health': {
    get: {
      tags: ['Microservices — Health & Readiness'],
      summary: 'Finance service health probe',
      operationId: 'FinanceHealth_live',
      responses: {
        '200': {
          description: 'Finance is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceHealthRes' },
            },
          },
        },
      },
    },
  },
  '/integration/health': {
    get: {
      tags: ['Microservices — Health & Readiness'],
      summary: 'Integration service health probe',
      operationId: 'IntegrationHealth_live',
      responses: {
        '200': {
          description: 'Integration is healthy',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ServiceHealthRes' },
            },
          },
        },
      },
    },
  },
};

/**
 * Merges the complete SapoClone microservice API catalog (Inventory, Sales,
 * Insight, Catalog, Customer, Finance, Integration) into the Platform OpenAPI
 * document so `/api-docs` displays the full system API in one unified page.
 */
export function mergeMicroserviceOpenApi(
  document: OpenAPIObject,
): OpenAPIObject {
  const existingTags = document.tags ?? [];
  const existingTagNames = new Set(existingTags.map((t) => t.name));
  const mergedTags = [
    ...existingTags,
    ...MICROSERVICE_SWAGGER_TAGS.filter((t) => !existingTagNames.has(t.name)),
  ];

  document.tags = mergedTags;
  document.paths = {
    ...(document.paths ?? {}),
    ...MICROSERVICE_SWAGGER_PATHS,
  };
  document.components = {
    ...(document.components ?? {}),
    schemas: {
      ...(document.components?.schemas ?? {}),
      ...MICROSERVICE_SWAGGER_SCHEMAS,
    },
  };

  return document;
}
