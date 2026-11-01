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
      'Insight Service (M7 Core) — Cross-Service Audit Logs, Executive Dashboard, Revenue/Product/Inventory/Branch/Channel/Customer/Cashflow/Gross-Profit Reports, Export Jobs & Rebuild/Reconciliation (ADR-0021)',
  },
  {
    name: 'Catalog — Categories, Brands, Products, Variants & Pricing',
    description:
      'Catalog Service (M1 Core) — Categories, Brands, Attributes, Products, Variants, Barcodes, Units & Price Lists (ADR-0013)',
  },
  {
    name: 'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
    description:
      'Customer Service (M4 Core) — Customer Profiles, Addresses, Groups, Membership Tiers, Loyalty Wallet/Ledger & Point Holds (ADR-0016)',
  },
  {
    name: 'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
    description:
      'Finance Service (M5 Core) — Double-Entry Financial Journal, Cash Accounts, Cashbook Vouchers, Customer Receivables & Credit Holds, Supplier Payables, Payment Settlements, Refunds, COD Reconciliation & Shift/System Reconciliation (ADR-0017)',
  },
  {
    name: 'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
    description:
      'Integration Service (M6 Core) — Shopee/Lazada Channel Connections, Encrypted Credentials, Signed Webhook Ingress, SKU Mappings, Omnichannel Order Sync, Inventory Availability Publication, Sync Jobs, Conflicts & Reconciliation (ADR-0018)',
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

  '/inventory/api/v1/warehouses/{id}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get warehouse details by ID',
      operationId: 'WarehousesController_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Warehouse details' } },
    },
    patch: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Update warehouse or deactivate with precondition check',
      operationId: 'WarehousesController_update',
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
        '200': { description: 'Updated warehouse' },
        '409': { description: 'WAREHOUSE_HAS_PENDING_OPERATIONS' },
      },
    },
  },
  '/inventory/api/v1/stocks': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'List M2 warehouse stock balances with available_qty and valuation',
      operationId: 'StockQueryController_listStocks',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Paginated warehouse stock balances' },
      },
    },
  },
  '/inventory/api/v1/stocks/{skuId}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get aggregated and per-warehouse stock summary for a SKU',
      operationId: 'StockQueryController_getSkuStockSummary',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'skuId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: {
        '200': { description: 'SKU stock summary across warehouses' },
      },
    },
  },
  '/inventory/api/v1/stocks/reconcile': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'Reconcile stock_balance rows against immutable stock_balance_ledger and HELD reservations',
      operationId: 'StockQueryController_reconcile',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Reconciliation report' } },
    },
  },
  '/inventory/api/v1/stock-movements': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Query immutable stock movement ledger entries',
      operationId: 'StockQueryController_listMovements',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Paginated stock movements' } },
    },
  },
  '/inventory/api/v1/stock-thresholds': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'List configured stock thresholds and active LOW_STOCK / OUT_OF_STOCK / OVER_MAX_STOCK alerts',
      operationId: 'StockQueryController_listThresholds',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Stock thresholds and alerts' } },
    },
    put: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Upsert stock threshold for a (warehouseId, skuId) pair',
      operationId: 'StockQueryController_upsertThreshold',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Upserted stock threshold' } },
    },
  },
  '/inventory/api/v1/stock-receipts/{id}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get stock receipt document details by ID',
      operationId: 'ReceivingController_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Stock receipt document details' } },
    },
  },
  '/inventory/api/v1/stock-receipts/{id}/post': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'Approve and post a DRAFT stock receipt (updates weighted-average cost & ledger)',
      operationId: 'ReceivingController_post',
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
        '200': { description: 'Posted stock receipt' },
        '409': { description: 'STOCK_RECEIPT_ALREADY_POSTED' },
      },
    },
  },
  '/inventory/api/v1/stock-issues': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Create a stock issue document (DRAFT or immediate POST)',
      operationId: 'IssuingController_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Created stock issue' } },
    },
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List stock issue documents',
      operationId: 'IssuingController_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of stock issues' } },
    },
  },
  '/inventory/api/v1/stock-issues/{id}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get stock issue details by ID',
      operationId: 'IssuingController_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Stock issue details' } },
    },
  },
  '/inventory/api/v1/stock-issues/{id}/post': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'Approve and post a DRAFT stock issue (verifies available unreserved stock)',
      operationId: 'IssuingController_post',
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
        '200': { description: 'Posted stock issue' },
        '409': {
          description: 'INSUFFICIENT_STOCK or STOCK_ISSUE_ALREADY_POSTED',
        },
      },
    },
  },
  '/inventory/api/v1/stock-transfers': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Create a multi-warehouse stock transfer document (DRAFT)',
      operationId: 'TransfersController_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Created stock transfer' } },
    },
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List multi-warehouse stock transfers',
      operationId: 'TransfersController_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of stock transfers' } },
    },
  },
  '/inventory/api/v1/stock-transfers/{id}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get stock transfer details by ID',
      operationId: 'TransfersController_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Stock transfer details' } },
    },
  },
  '/inventory/api/v1/stock-transfers/{id}/dispatch': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'Dispatch a DRAFT stock transfer (deducts source on_hand_qty and increments destination in_transit_qty)',
      operationId: 'TransfersController_dispatch',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Dispatched stock transfer' } },
    },
  },
  '/inventory/api/v1/stock-transfers/{id}/receive': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'Receive a dispatched stock transfer at destination warehouse (partial or full with discrepancy tracking)',
      operationId: 'TransfersController_receive',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Received stock transfer' } },
    },
  },
  '/inventory/api/v1/stocktakes': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Create a physical stocktake session with snapshot capture',
      operationId: 'StocktakeController_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Created stocktake session' } },
    },
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List stocktake sessions',
      operationId: 'StocktakeController_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of stocktake sessions' } },
    },
  },
  '/inventory/api/v1/stocktakes/{id}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get stocktake session details by ID',
      operationId: 'StocktakeController_getById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Stocktake session details' } },
    },
  },
  '/inventory/api/v1/stocktakes/{id}/counts': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Record physical counted quantities for a stocktake session',
      operationId: 'StocktakeController_recordCounts',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Updated stocktake counts' } },
    },
  },
  '/inventory/api/v1/stocktakes/{id}/approve': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Approve a stocktake session and post variance adjustments',
      operationId: 'StocktakeController_approve',
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
        '200': { description: 'Approved stocktake' },
        '409': {
          description: 'STOCKTAKE_STALE_SNAPSHOT or STOCKTAKE_BELOW_RESERVED',
        },
      },
    },
  },
  '/inventory/api/v1/suppliers': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Create a supplier',
      operationId: 'ProcurementController_createSupplier',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Created supplier' } },
    },
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List suppliers',
      operationId: 'ProcurementController_listSuppliers',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of suppliers' } },
    },
  },
  '/inventory/api/v1/suppliers/{id}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get supplier details by ID',
      operationId: 'ProcurementController_getSupplierById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Supplier details' } },
    },
    patch: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Update supplier details',
      operationId: 'ProcurementController_updateSupplier',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Updated supplier' } },
    },
  },
  '/inventory/api/v1/purchase-orders': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Create a purchase order (DRAFT)',
      operationId: 'ProcurementController_createPurchaseOrder',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Created purchase order' } },
    },
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'List purchase orders',
      operationId: 'ProcurementController_listPurchaseOrders',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of purchase orders' } },
    },
  },
  '/inventory/api/v1/purchase-orders/{id}': {
    get: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Get purchase order details by ID',
      operationId: 'ProcurementController_getPurchaseOrderById',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Purchase order details' } },
    },
  },
  '/inventory/api/v1/purchase-orders/{id}/approve': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary: 'Approve a DRAFT purchase order',
      operationId: 'ProcurementController_approvePurchaseOrder',
      security: [{ bearer: [] }],
      parameters: [
        {
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'Approved purchase order' } },
    },
  },
  '/inventory/api/v1/purchase-orders/{id}/receive': {
    post: {
      tags: ['Inventory — Stock & Warehouses'],
      summary:
        'Receive goods against an approved purchase order (partial or full)',
      operationId: 'ProcurementController_receivePurchaseOrder',
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
          description: 'Updated purchase order and posted stock receipt',
        },
        '409': { description: 'OVER_RECEIPT_NOT_ALLOWED' },
      },
    },
  },

  // =========================================================================
  // INVENTORY SERVICE — INTERNAL RESERVATIONS (EAST-WEST)
  // =========================================================================
  '/internal/v1/reservations': {
    get: {
      tags: ['Inventory — Internal Reservations'],
      summary:
        '[Internal East-West] List warehouse reservations by orderId for timeout recovery',
      operationId: 'WarehouseReservationsController_listByOrder',
      parameters: [
        {
          name: 'X-Tenant-Id',
          in: 'header',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
        {
          name: 'orderId',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'uuid' },
        },
      ],
      responses: { '200': { description: 'List of reservations for order' } },
    },
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
  '/internal/v1/reservations/by-key/{idempotencyKey}': {
    get: {
      tags: ['Inventory — Internal Reservations'],
      summary:
        '[Internal East-West] Inspect warehouse reservation by Idempotency-Key',
      description:
        'Used by Sales timeout recovery when original response timed out before reservationId was received.',
      operationId: 'WarehouseReservationsController_getByKey',
      parameters: [
        {
          name: 'idempotencyKey',
          in: 'path',
          required: true,
          schema: { type: 'string' },
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
  '/api/v1/pos/shifts/open': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Open a POS cashier shift',
      operationId: 'SalesPosShifts_open',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'POS shift opened' } },
    },
  },
  '/api/v1/pos/shifts/active': {
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Get active POS shift for current cashier',
      operationId: 'SalesPosShifts_active',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Active POS shift' } },
    },
  },
  '/api/v1/pos/shifts/{id}/close': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Close a POS cashier shift and reconcile cash variance',
      operationId: 'SalesPosShifts_close',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'POS shift closed and reconciled' } },
    },
  },
  '/api/v1/pos/products/lookup': {
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Lookup POS product variant by SKU or barcode',
      operationId: 'SalesPos_lookupProduct',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Authoritative Catalog variant' } },
    },
  },
  '/api/v1/pos/quote': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Calculate authoritative POS order quote & discount waterfall',
      operationId: 'SalesPos_quote',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Calculated POS quote' } },
    },
  },
  '/api/v1/pos/drafts': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Create a POS draft invoice (max 5 active per staff per branch)',
      operationId: 'SalesPos_createDraft',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'POS draft created' } },
    },
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'List active POS draft invoices for current staff',
      operationId: 'SalesPos_listDrafts',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Active POS drafts' } },
    },
  },
  '/api/v1/pos/checkout': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary:
        'Execute POS checkout saga (price waterfall + stock reserve/commit + tender settlement)',
      operationId: 'SalesPos_checkout',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'POS checkout completed' } },
    },
  },
  '/api/v1/pos/checkouts/{id}/retry': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Retry / recover a pending or timed-out POS checkout workflow',
      operationId: 'SalesPos_retryCheckout',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Recovered POS checkout' } },
    },
  },
  '/api/v1/pos/checkouts/{id}/confirm-payment': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary:
        'Confirm pending electronic payment on an AWAITING_PAYMENT POS checkout',
      operationId: 'SalesPos_confirmPayment',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Payment confirmed and order finalized' },
      },
    },
  },
  '/api/v1/orders/omnichannel': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary:
        'Create an omnichannel / manual / marketplace sales order with external idempotency',
      operationId: 'SalesOrders_createOmnichannel',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Omnichannel order created' } },
    },
  },
  '/api/v1/orders/{id}/confirm': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Confirm a DRAFT/PENDING order and reserve warehouse stock',
      operationId: 'SalesOrders_confirm',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Order confirmed and stock reserved' },
      },
    },
  },
  '/api/v1/orders/{id}/cancel': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Cancel an unfulfilled order and release stock reservation',
      operationId: 'SalesOrders_cancel',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Order cancelled' } },
    },
  },
  '/api/v1/returns': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary:
        'Create a partial or full return against a completed/fulfilled order',
      operationId: 'SalesReturns_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Sales return created' } },
    },
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'List sales returns',
      operationId: 'SalesReturns_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Sales returns list' } },
    },
  },
  '/api/v1/returns/{id}/receive': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary:
        'Receive returned goods into warehouse inventory and complete return',
      operationId: 'SalesReturns_receive',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Returned goods received' } },
    },
  },
  '/api/v1/returns/{id}/refund-request': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Create an idempotent refund request for a sales return',
      operationId: 'SalesReturns_createRefundRequest',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Refund request created' } },
    },
  },
  '/api/v1/orders/{id}/fulfillments': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Create a fulfillment record for an order',
      operationId: 'SalesFulfillments_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Fulfillment created' } },
    },
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'List fulfillments for an order',
      operationId: 'SalesFulfillments_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Order fulfillments' } },
    },
  },
  '/api/v1/fulfillments/{id}/confirm': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary:
        'Confirm fulfillment completion and commit warehouse stock reservation',
      operationId: 'SalesFulfillments_confirm',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Fulfillment confirmed' } },
    },
  },
  '/api/v1/promotions': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Create a promotion rule',
      operationId: 'SalesPromotions_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Promotion created' } },
    },
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'List promotions for current tenant',
      operationId: 'SalesPromotions_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Promotions list' } },
    },
  },
  '/api/v1/coupons': {
    post: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'Create a coupon code linked to a promotion',
      operationId: 'SalesCoupons_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Coupon created' } },
    },
    get: {
      tags: ['Sales — Orders & Checkouts'],
      summary: 'List coupons for current tenant',
      operationId: 'SalesCoupons_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Coupons list' } },
    },
  },
  '/api/v1/customers': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Create a customer profile and initialize their loyalty wallet atomically',
      operationId: 'CustomerProfiles_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Customer profile created' } },
    },
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'List and search customers with cursor/offset pagination and optional PII masking',
      operationId: 'CustomerProfiles_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer profiles page' } },
    },
  },
  '/api/v1/customers/lookup': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Fast exact customer lookup by normalized phone, code, or email for POS',
      operationId: 'CustomerProfiles_lookup',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer lookup result' } },
    },
  },
  '/api/v1/customers/{id}': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Get customer profile by ID',
      operationId: 'CustomerProfiles_getById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer profile' } },
    },
    patch: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Update customer profile with optional optimistic concurrency version check',
      operationId: 'CustomerProfiles_update',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Updated customer profile' } },
    },
    delete: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Deactivate or privacy-anonymize a customer profile',
      operationId: 'CustomerProfiles_deactivate',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Deactivated or anonymized customer' },
      },
    },
  },
  '/api/v1/customers/{id}/summary': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Get 360-degree customer summary (profile, loyalty, purchase projection, financial summary)',
      operationId: 'CustomerProfiles_getSummary',
      security: [{ bearer: [] }],
      responses: { '200': { description: '360-degree customer summary' } },
    },
  },
  '/api/v1/customers/{id}/orders': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'List historical orders for a customer from event-driven purchase projection',
      operationId: 'CustomerProfiles_listOrders',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer purchase history' } },
    },
  },
  '/api/v1/customers/{id}/purchase-summary': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Get aggregated purchase metrics from event-driven purchase projection',
      operationId: 'CustomerProfiles_getPurchaseSummary',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer purchase summary' } },
    },
  },
  '/api/v1/customers/{id}/addresses': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Add an address to a customer profile',
      operationId: 'CustomerAddresses_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Address created' } },
    },
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'List active addresses for a customer',
      operationId: 'CustomerAddresses_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer addresses' } },
    },
  },
  '/api/v1/customers/{id}/addresses/{addressId}': {
    patch: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Update a customer address',
      operationId: 'CustomerAddresses_update',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Address updated' } },
    },
    delete: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Soft-deactivate a customer address',
      operationId: 'CustomerAddresses_delete',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Address deactivated' } },
    },
  },
  '/api/v1/customers/{id}/addresses/{addressId}/set-default': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Set an address as the single active default address',
      operationId: 'CustomerAddresses_setDefault',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Default address updated' } },
    },
  },
  '/api/v1/customer-groups': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Create a customer group (VIP, Wholesale, Member)',
      operationId: 'CustomerGroups_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Customer group created' } },
    },
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'List customer groups for current tenant',
      operationId: 'CustomerGroups_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer groups' } },
    },
  },
  '/api/v1/customer-groups/{id}': {
    patch: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Update or deactivate a customer group',
      operationId: 'CustomerGroups_update',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer group updated' } },
    },
  },
  '/api/v1/customers/{id}/assign-group': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Assign or unassign a customer to a customer group',
      operationId: 'CustomerGroups_assign',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer group assigned' } },
    },
  },
  '/api/v1/membership-tiers': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Create a membership tier (Member, Silver, Gold, Platinum)',
      operationId: 'CustomerMembershipTiers_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Membership tier created' } },
    },
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'List membership tiers for current tenant',
      operationId: 'CustomerMembershipTiers_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Membership tiers' } },
    },
  },
  '/api/v1/membership-tiers/{id}': {
    patch: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Update a membership tier configuration',
      operationId: 'CustomerMembershipTiers_update',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Membership tier updated' } },
    },
  },
  '/api/v1/customers/{id}/membership': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Get customer membership tier and qualification progress',
      operationId: 'CustomerMembershipTiers_getCustomerMembership',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer membership tier' } },
    },
  },
  '/api/v1/loyalty/settings': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Get tenant loyalty program configuration',
      operationId: 'CustomerLoyalty_getSettings',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Loyalty settings' } },
    },
    put: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Update tenant loyalty program configuration',
      operationId: 'CustomerLoyalty_updateSettings',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Updated loyalty settings' } },
    },
  },
  '/api/v1/customers/{id}/loyalty': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Get customer loyalty account balance (posted, held, available, qualifying)',
      operationId: 'CustomerLoyalty_getAccount',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Loyalty account balance' } },
    },
  },
  '/api/v1/customers/{id}/loyalty/transactions': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'List immutable loyalty ledger transactions for a customer',
      operationId: 'CustomerLoyalty_listTransactions',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Loyalty ledger transactions' } },
    },
  },
  '/api/v1/customers/{id}/loyalty/adjustments': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Privileged manual loyalty point adjustment with mandatory reason and idempotency',
      operationId: 'CustomerLoyalty_adjustPoints',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Loyalty points adjusted' } },
    },
  },
  '/api/v1/loyalty/reconcile': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Run loyalty wallet vs. ledger & hold reconciliation and expire overdue holds',
      operationId: 'CustomerLoyalty_reconcile',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Loyalty reconciliation report' } },
    },
  },
  '/api/v1/customers/duplicates': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Detect duplicate customer profiles within the tenant',
      operationId: 'CustomerDataManagement_findDuplicates',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Duplicate customer groups' } },
    },
  },
  '/api/v1/customers/merge': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Merge source customer into target customer with atomic loyalty ledger transfer',
      operationId: 'CustomerDataManagement_merge',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Customers merged' } },
    },
  },
  '/api/v1/customers/import-jobs': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Create a customer CSV/batch import job with row-level validation',
      operationId: 'CustomerDataManagement_createImportJob',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Import job completed' } },
    },
  },
  '/api/v1/customers/import-jobs/{id}': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Get customer import job status and row errors',
      operationId: 'CustomerDataManagement_getImportJob',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Import job status' } },
    },
  },
  '/api/v1/customers/export-jobs': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Create a formula-injection-safe customer CSV export job with optional PII masking',
      operationId: 'CustomerDataManagement_createExportJob',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Export job completed' } },
    },
  },
  '/api/v1/customers/export-jobs/{id}': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Get customer export job status and CSV output',
      operationId: 'CustomerDataManagement_getExportJob',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Export job status' } },
    },
  },
  '/internal/v1/customers/{id}/eligibility': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Internal S2S: Fetch customer eligibility, discounts, and loyalty balance for POS',
      operationId: 'CustomerInternal_getEligibility',
      responses: { '200': { description: 'Customer eligibility' } },
    },
  },
  '/internal/v1/loyalty/accounts/{customerId}': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Internal S2S: Get customer loyalty account balance for checkout',
      operationId: 'CustomerInternal_getLoyaltyAccount',
      responses: { '200': { description: 'Customer loyalty account' } },
    },
  },
  '/internal/v1/loyalty/holds': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Internal S2S: Atomically hold loyalty points for POS checkout',
      operationId: 'CustomerInternal_createHold',
      responses: { '201': { description: 'Loyalty hold created' } },
    },
  },
  '/internal/v1/loyalty/holds/{id}': {
    get: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary: 'Internal S2S: Inspect a loyalty point hold',
      operationId: 'CustomerInternal_getHold',
      responses: { '200': { description: 'Loyalty hold details' } },
    },
  },
  '/internal/v1/loyalty/holds/{id}/commit': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Internal S2S: Commit HELD loyalty points into an immutable REDEEM ledger entry',
      operationId: 'CustomerInternal_commitHold',
      responses: { '200': { description: 'Loyalty hold committed' } },
    },
  },
  '/internal/v1/loyalty/holds/{id}/release': {
    post: {
      tags: [
        'Customer — Profiles, Segmentation, Membership Tiers & Loyalty Ledger',
      ],
      summary:
        'Internal S2S: Release HELD loyalty points on checkout cancellation',
      operationId: 'CustomerInternal_releaseHold',
      responses: { '200': { description: 'Loyalty hold released' } },
    },
  },

  // =========================================================================
  // FINANCE SERVICE (M5 CORE) — JOURNALS, CASHBOOK, AR, AP, CREDIT, SETTLEMENTS, REFUNDS, COD & RECONCILIATION
  // =========================================================================
  '/api/v1/finance/accounts': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List tenant chart of financial accounts',
      operationId: 'FinanceJournal_listAccounts',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Financial accounts list' } },
    },
  },
  '/api/v1/finance/journals': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List posted double-entry financial journals with pagination',
      operationId: 'FinanceJournal_listJournals',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Financial journals page' } },
    },
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Post a manual balanced double-entry financial journal',
      operationId: 'FinanceJournal_postManualJournal',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Financial journal posted' } },
    },
  },
  '/api/v1/finance/journals/{id}': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Get financial journal header and balanced debit/credit lines',
      operationId: 'FinanceJournal_getJournalById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Financial journal details' } },
    },
  },
  '/api/v1/finance/journals/{id}/reverse': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Reverse a posted financial journal by posting an offsetting reversal journal',
      operationId: 'FinanceJournal_reverseJournal',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Reversal journal posted' } },
    },
  },
  '/api/v1/finance/cash-accounts': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Create a branch cash drawer, bank account, or e-wallet cash account',
      operationId: 'FinanceCashAccounts_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Cash account created' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List cash accounts and current balances',
      operationId: 'FinanceCashAccounts_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cash accounts list' } },
    },
  },
  '/api/v1/finance/cash-accounts/{id}': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Get cash account details and balance',
      operationId: 'FinanceCashAccounts_getById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cash account details' } },
    },
    patch: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Update cash account metadata or status (ACTIVE, INACTIVE, CLOSED)',
      operationId: 'FinanceCashAccounts_update',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Updated cash account' } },
    },
  },
  '/api/v1/finance/cashbook/categories': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List cashbook receipt and expense categories',
      operationId: 'FinanceCashbook_listCategories',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cashbook categories' } },
    },
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Create a custom cashbook category',
      operationId: 'FinanceCashbook_createCategory',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Cashbook category created' } },
    },
  },
  '/api/v1/finance/cashbook/receipts': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Create and optionally post a cashbook receipt voucher (PT)',
      operationId: 'FinanceCashbook_createReceipt',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Cashbook receipt voucher created' } },
    },
  },
  '/api/v1/finance/cashbook/expenses': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Create and optionally post a cashbook expense voucher (PC)',
      operationId: 'FinanceCashbook_createExpense',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Cashbook expense voucher created' } },
    },
  },
  '/api/v1/finance/cashbook/entries': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List cashbook entries with filtering and pagination',
      operationId: 'FinanceCashbook_listEntries',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cashbook entries page' } },
    },
  },
  '/api/v1/finance/cashbook/export': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Export cashbook entries as CSV',
      operationId: 'FinanceCashbook_exportCsv',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'CSV export payload' } },
    },
  },
  '/api/v1/finance/cashbook/entries/{id}': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Get cashbook voucher details',
      operationId: 'FinanceCashbook_getEntryById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cashbook voucher details' } },
    },
  },
  '/api/v1/finance/cashbook/entries/{id}/approve': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Approve a DRAFT cashbook voucher',
      operationId: 'FinanceCashbook_approveEntry',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cashbook voucher approved' } },
    },
  },
  '/api/v1/finance/cashbook/entries/{id}/post': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Post a cashbook voucher and update cash account balance atomically',
      operationId: 'FinanceCashbook_postEntry',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cashbook voucher posted' } },
    },
  },
  '/api/v1/finance/cashbook/entries/{id}/reverse': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Reverse a posted cashbook voucher via offsetting reversal entry',
      operationId: 'FinanceCashbook_reverseEntry',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cashbook voucher reversed' } },
    },
  },
  '/api/v1/finance/customers/{customerId}/credit-profile': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Get customer credit profile, posted debt, held credit, and available credit',
      operationId: 'FinanceCredit_getProfile',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer credit profile' } },
    },
    put: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Update customer credit limit and credit status',
      operationId: 'FinanceCredit_updateLimit',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Updated customer credit profile' } },
    },
  },
  '/api/v1/finance/receivables': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Recognize a customer receivable (AR) and post debt ledger & journal',
      operationId: 'FinanceReceivables_recognize',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Customer receivable recognized' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List customer receivables with filtering and pagination',
      operationId: 'FinanceReceivables_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer receivables page' } },
    },
  },
  '/api/v1/finance/receivables/{id}': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Get customer receivable details',
      operationId: 'FinanceReceivables_getById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer receivable details' } },
    },
  },
  '/api/v1/finance/receivables/{id}/payments': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Record a customer debt payment allocated to a receivable (never inflates sales revenue)',
      operationId: 'FinanceReceivables_recordPayment',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer debt payment applied' } },
    },
  },
  '/api/v1/finance/customers/{customerId}/debt': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Get customer debt summary, open receivables, and immutable debt statement ledger',
      operationId: 'FinanceReceivables_getCustomerDebtSummary',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Customer debt summary and statement' },
      },
    },
  },
  '/api/v1/finance/customers/{customerId}/debt-payments': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Record a multi-invoice FIFO or explicit customer debt payment',
      operationId: 'FinanceReceivables_recordCustomerDebtPayment',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Multi-invoice customer debt payment applied' },
      },
    },
  },
  '/api/v1/finance/payables': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Recognize a supplier payable (AP) and post supplier debt ledger & journal',
      operationId: 'FinancePayables_recognize',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Supplier payable recognized' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List supplier payables with filtering and pagination',
      operationId: 'FinancePayables_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Supplier payables page' } },
    },
  },
  '/api/v1/finance/payables/{id}': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Get supplier payable details',
      operationId: 'FinancePayables_getById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Supplier payable details' } },
    },
  },
  '/api/v1/finance/payables/{id}/payments': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Record a supplier payment and post cashbook expense voucher & journal',
      operationId: 'FinancePayables_recordPayment',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Supplier payment recorded' } },
    },
  },
  '/api/v1/finance/payables/{id}/return-credits': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Apply a supplier return credit note to reduce supplier payable',
      operationId: 'FinancePayables_applyReturnCredit',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Supplier return credit applied' } },
    },
  },
  '/api/v1/finance/suppliers/{supplierId}/debt': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Get supplier debt summary, open payables, and supplier debt statement ledger',
      operationId: 'FinancePayables_getSupplierDebtSummary',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Supplier debt summary and statement' },
      },
    },
  },
  '/api/v1/finance/settlements': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Confirm or record a payment tender settlement',
      operationId: 'FinanceSettlements_confirm',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Payment settlement recorded' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List payment settlements with filtering and pagination',
      operationId: 'FinanceSettlements_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Payment settlements page' } },
    },
  },
  '/api/v1/finance/settlements/callbacks': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Process idempotent payment provider callback / settlement notification',
      operationId: 'FinanceSettlements_processCallback',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Provider callback processed' } },
    },
  },
  '/api/v1/finance/settlements/{id}': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Get payment settlement details',
      operationId: 'FinanceSettlements_getById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Payment settlement details' } },
    },
  },
  '/api/v1/finance/refunds': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Create a refund operation enforcing remaining refundable cap per order',
      operationId: 'FinanceRefunds_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Refund operation created' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List refund operations with filtering and pagination',
      operationId: 'FinanceRefunds_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Refund operations page' } },
    },
  },
  '/api/v1/finance/refunds/{id}/approve': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Approve a REQUESTED refund operation',
      operationId: 'FinanceRefunds_approve',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Refund operation approved' } },
    },
  },
  '/api/v1/finance/refunds/{id}/execute': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Execute an approved refund (enters PENDING_CONFIRMATION on external provider timeout, never fabricating completion)',
      operationId: 'FinanceRefunds_execute',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Refund execution outcome' } },
    },
  },
  '/api/v1/finance/refunds/{id}/confirm': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Confirm or reconcile a PENDING_CONFIRMATION external refund outcome',
      operationId: 'FinanceRefunds_confirmOutcome',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Refund outcome confirmed' } },
    },
  },
  '/api/v1/finance/cod/receivables': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Register a carrier COD receivable for a shipment',
      operationId: 'FinanceCod_createReceivable',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'COD receivable registered' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List carrier COD receivables with filtering and pagination',
      operationId: 'FinanceCod_listReceivables',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'COD receivables page' } },
    },
  },
  '/api/v1/finance/cod/settlement-batches': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Import and reconcile a carrier COD settlement statement batch',
      operationId: 'FinanceCod_importBatch',
      security: [{ bearer: [] }],
      responses: {
        '201': { description: 'COD settlement batch imported and reconciled' },
      },
    },
  },
  '/api/v1/finance/reconciliation/shifts': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Reconcile POS shift closing cash and post shortage/overage variance journal',
      operationId: 'FinanceReconciliation_reconcileShift',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'POS shift cash reconciled' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List POS shift cash reconciliations',
      operationId: 'FinanceReconciliation_listShifts',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Shift reconciliations list' } },
    },
  },
  '/api/v1/finance/adjustments': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Create a financial adjustment request (requires Maker-Checker approval)',
      operationId: 'FinanceReconciliation_createAdjustment',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Financial adjustment created' } },
    },
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List financial adjustments',
      operationId: 'FinanceReconciliation_listAdjustments',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Financial adjustments list' } },
    },
  },
  '/api/v1/finance/adjustments/{id}/approve': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Approve and post a financial adjustment (enforces Maker-Checker separation)',
      operationId: 'FinanceReconciliation_approveAdjustment',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Financial adjustment approved and posted' },
      },
    },
  },
  '/api/v1/finance/reconciliation/runs': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'Trigger a cross-ledger financial reconciliation run',
      operationId: 'FinanceReconciliation_triggerRun',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Reconciliation run completed' } },
    },
  },
  '/api/v1/finance/reconciliation/issues': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary: 'List financial reconciliation issues',
      operationId: 'FinanceReconciliation_listIssues',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Reconciliation issues page' } },
    },
  },
  '/api/v1/finance/reconciliation/issues/{id}/resolve': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Resolve or ignore a financial reconciliation issue with audit note',
      operationId: 'FinanceReconciliation_resolveIssue',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Reconciliation issue resolved' } },
    },
  },
  '/api/v1/finance/summary': {
    get: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        'Get tenant-wide operational finance summary (cash, AR, AP, COD, open issues)',
      operationId: 'FinanceReconciliation_getSummary',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Tenant finance summary' } },
    },
  },
  '/internal/v1/finance/credit-authorizations': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        '[Internal East-West] Authorize and place a concurrency-safe customer credit hold for POS/Order checkout',
      operationId: 'FinanceInternalCredit_authorize',
      responses: { '201': { description: 'Credit authorization hold placed' } },
    },
  },
  '/internal/v1/finance/credit-authorizations/{id}/commit': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        '[Internal East-West] Commit a HELD credit authorization into a posted customer receivable and journal',
      operationId: 'FinanceInternalCredit_commit',
      responses: { '200': { description: 'Credit authorization committed' } },
    },
  },
  '/internal/v1/finance/credit-authorizations/{id}/release': {
    post: {
      tags: [
        'Finance — Journals, Cashbook, Receivables, Payables, Credit, Settlements, Refunds, COD & Reconciliation',
      ],
      summary:
        '[Internal East-West] Release a HELD credit authorization on checkout failure/cancellation',
      operationId: 'FinanceInternalCredit_release',
      responses: { '200': { description: 'Credit authorization released' } },
    },
  },
  '/api/v1/integrations/providers': {
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'List supported marketplace providers and capability matrix (Shopee v2, Lazada)',
      operationId: 'IntegrationConnections_listProviders',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Provider capability matrix' } },
    },
  },
  '/api/v1/integrations/connections': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Create a marketplace channel connection with AES-256-GCM encrypted credentials',
      operationId: 'IntegrationConnections_create',
      security: [{ bearer: [] }],
      responses: {
        '201': { description: 'Sanitized channel connection created' },
      },
    },
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'List tenant marketplace channel connections (sanitized credential metadata)',
      operationId: 'IntegrationConnections_list',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'List of sanitized channel connections' },
      },
    },
  },
  '/api/v1/integrations/connections/{id}': {
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary: 'Get sanitized channel connection details by ID',
      operationId: 'IntegrationConnections_getById',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Sanitized channel connection details' },
      },
    },
    delete: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Disconnect a marketplace channel connection and revoke stored tokens',
      operationId: 'IntegrationConnections_disconnect',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Channel connection disconnected' } },
    },
  },
  '/api/v1/integrations/connections/{id}/authorize': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Initiate OAuth/partner authorization or complete callback state exchange',
      operationId: 'IntegrationConnections_authorize',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Authorization URL or connected view' },
      },
    },
  },
  '/api/v1/integrations/connections/{id}/refresh-token': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Concurrency-safe credential token refresh with lease & CAS version guard',
      operationId: 'IntegrationConnections_refreshToken',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Token refresh outcome' } },
    },
  },
  '/api/v1/integrations/connections/{id}/health': {
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Inspect channel connection health, token expiry, circuit breaker & sync lag',
      operationId: 'IntegrationConnections_health',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Channel connection health diagnostics' },
      },
    },
  },
  '/api/v1/integrations/sku-mappings': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Create an explicit SKU mapping between marketplace variation and internal Catalog variant',
      operationId: 'IntegrationSkuMapping_create',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'SKU mapping created' } },
    },
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'List SKU mappings with optional connection, variant, or status filters',
      operationId: 'IntegrationSkuMapping_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'SKU mappings list' } },
    },
  },
  '/api/v1/integrations/sku-mappings/{id}': {
    patch: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary: 'Update a SKU mapping and increment mappingVersion',
      operationId: 'IntegrationSkuMapping_update',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'SKU mapping updated' } },
    },
    delete: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary: 'Delete a SKU mapping with audit log entry',
      operationId: 'IntegrationSkuMapping_delete',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'SKU mapping deleted' } },
    },
  },
  '/api/v1/integrations/connections/{id}/sync/orders': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Trigger manual or incremental external order synchronization for a connection',
      operationId: 'IntegrationSyncJobs_syncOrders',
      security: [{ bearer: [] }],
      responses: { '202': { description: 'Order sync job enqueued/executed' } },
    },
  },
  '/api/v1/integrations/connections/{id}/sync/inventory': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Trigger sellable inventory availability publication for a connection',
      operationId: 'IntegrationSyncJobs_syncInventory',
      security: [{ bearer: [] }],
      responses: {
        '202': { description: 'Inventory sync job enqueued/executed' },
      },
    },
  },
  '/api/v1/integrations/connections/{id}/sync/products': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Trigger external product listing discovery and exact-SKU auto-mapping',
      operationId: 'IntegrationSyncJobs_syncProducts',
      security: [{ bearer: [] }],
      responses: {
        '202': { description: 'Product sync job enqueued/executed' },
      },
    },
  },
  '/api/v1/integrations/sync-jobs': {
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary: 'List durable synchronization jobs across connections',
      operationId: 'IntegrationSyncJobs_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of sync jobs' } },
    },
  },
  '/api/v1/integrations/sync-jobs/{id}': {
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary: 'Get sync job details and execution summary by ID',
      operationId: 'IntegrationSyncJobs_getById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Sync job details' } },
    },
  },
  '/api/v1/integrations/sync-jobs/{id}/retry': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Authorized operator replay of a failed or dead-lettered sync job',
      operationId: 'IntegrationSyncJobs_retry',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Sync job replayed' } },
    },
  },
  '/api/v1/integrations/conflicts': {
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'List synchronization conflicts (SKU_UNMAPPED, STOCK_INSUFFICIENT, ORDER_STATE_CONFLICT)',
      operationId: 'IntegrationConflicts_list',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of sync conflicts' } },
    },
  },
  '/api/v1/integrations/conflicts/{id}/resolve': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Resolve a synchronization conflict and optionally re-trigger order import',
      operationId: 'IntegrationConflicts_resolve',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Conflict resolved' } },
    },
  },
  '/api/v1/integrations/reconciliation-runs': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        'Execute an omnichannel reconciliation run across orders, stock publications & DLQ',
      operationId: 'IntegrationReconciliation_run',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Reconciliation run completed' } },
    },
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary: 'List omnichannel reconciliation runs',
      operationId: 'IntegrationReconciliation_listRuns',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of reconciliation runs' } },
    },
  },
  '/api/v1/integrations/reconciliation-runs/{id}': {
    get: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary: 'Get reconciliation run details and detected discrepancy issues',
      operationId: 'IntegrationReconciliation_getRunById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Reconciliation run details' } },
    },
  },
  '/webhooks/v1/{provider}/{connectionKey}': {
    post: {
      tags: [
        'Integration — Marketplace Connections, Webhooks, SKU Mapping, Order/Inventory Sync & Reconciliation',
      ],
      summary:
        '[Public External Webhook Ingress] Verify HMAC-SHA256 signature on raw body, enforce replay window, persist to durable webhook inbox & enqueue sync job',
      operationId: 'IntegrationWebhooks_ingest',
      responses: {
        '200': { description: 'Webhook verified and durably persisted' },
        '401': {
          description: 'INVALID_WEBHOOK_SIGNATURE or WEBHOOK_REPLAY_REJECTED',
        },
        '503': { description: 'WEBHOOK_PERSISTENCE_FAILED' },
      },
    },
  },
  '/api/v1/insight/dashboard/overview': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get executive dashboard KPI overview (gross/net sales, COGS, gross profit, margin, AOV, low-stock, receivables, COD pending, prior-period growth & freshness)',
      operationId: 'InsightDashboard_getOverview',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Executive dashboard overview' } },
    },
  },
  '/api/v1/insight/dashboard/revenue-trend': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get revenue trend time-series with zero-filled date buckets',
      operationId: 'InsightDashboard_getRevenueTrend',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Revenue trend time-series' } },
    },
  },
  '/api/v1/insight/dashboard/top-products': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get top-selling products ranked by net revenue or units sold with deterministic tie-breakers',
      operationId: 'InsightDashboard_getTopProducts',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Top products ranking' } },
    },
  },
  '/api/v1/insight/dashboard/alerts': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get operational alerts (low-stock SKUs, stale projections, open reconciliation discrepancies)',
      operationId: 'InsightDashboard_getAlerts',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Operational dashboard alerts' } },
    },
  },
  '/api/v1/insight/reports/revenue': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get revenue report grouped by day, week, or month with branch and channel filters',
      operationId: 'InsightReports_getRevenue',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Revenue report' } },
    },
  },
  '/api/v1/insight/reports/products': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get product/SKU sales performance report with net sales, returns, COGS, and gross profit',
      operationId: 'InsightReports_getProducts',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Product performance report' } },
    },
  },
  '/api/v1/insight/reports/categories': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get category sales performance report',
      operationId: 'InsightReports_getCategories',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Category performance report' } },
    },
  },
  '/api/v1/insight/reports/branches': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get branch performance ranking and comparison report',
      operationId: 'InsightReports_getBranches',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Branch performance report' } },
    },
  },
  '/api/v1/insight/reports/channels': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get sales channel performance report with revenue share percentage',
      operationId: 'InsightReports_getChannels',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Channel performance report' } },
    },
  },
  '/api/v1/insight/reports/customers': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get customer purchasing and receivable exposure analytics report',
      operationId: 'InsightReports_getCustomers',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Customer analytics report' } },
    },
  },
  '/api/v1/insight/reports/returns-cancellations': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get returns and cancellations analytical report',
      operationId: 'InsightReports_getReturnsCancellations',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Returns & cancellations report' } },
    },
  },
  '/api/v1/insight/reports/inventory/stock': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get current inventory stock, reserved, available, and valuation projection report',
      operationId: 'InsightReports_getInventoryStock',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Inventory stock report' } },
    },
  },
  '/api/v1/insight/reports/inventory/low-stock': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get low-stock SKU alert report',
      operationId: 'InsightReports_getInventoryLowStock',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Low-stock SKU report' } },
    },
  },
  '/api/v1/insight/reports/inventory/movements': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get inventory movement summary report (inbound, outbound, return-in, adjustment, damage)',
      operationId: 'InsightReports_getInventoryMovements',
      security: [{ bearer: [] }],
      responses: {
        '200': { description: 'Inventory movement summary report' },
      },
    },
  },
  '/api/v1/insight/reports/inventory/valuation': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get inventory valuation report by branch and SKU',
      operationId: 'InsightReports_getInventoryValuation',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Inventory valuation report' } },
    },
  },
  '/api/v1/insight/reports/inventory/slow-moving': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get slow-moving / dead-stock SKU report with days since last sale',
      operationId: 'InsightReports_getInventorySlowMoving',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Slow-moving inventory report' } },
    },
  },
  '/api/v1/insight/reports/gross-profit': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get gross profit and gross margin % summary report with cost-basis coverage disclosure',
      operationId: 'InsightReports_getGrossProfit',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Gross profit summary report' } },
    },
  },
  '/api/v1/insight/reports/gross-profit/products': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get gross profit and margin % breakdown by SKU/product',
      operationId: 'InsightReports_getGrossProfitByProduct',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Gross profit by product report' } },
    },
  },
  '/api/v1/insight/reports/cashflow': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get finance & cashflow summary report (inflows, outflows, refunds, receivables, COD pending)',
      operationId: 'InsightReports_getCashflow',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Cashflow summary report' } },
    },
  },
  '/api/v1/insight/export-jobs': {
    post: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Create and generate a deterministic report export job (CSV, XLSX, PDF) with formula-injection protection',
      operationId: 'InsightExports_createJob',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Export job created and generated' } },
    },
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'List report export jobs for the tenant',
      operationId: 'InsightExports_listJobs',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of export jobs' } },
    },
  },
  '/api/v1/insight/export-jobs/{id}': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get report export job details and checksum metadata',
      operationId: 'InsightExports_getJobById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Export job details' } },
    },
  },
  '/api/v1/insight/export-jobs/{id}/download': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Download generated export artifact (CSV, XLSX, or PDF)',
      operationId: 'InsightExports_downloadJob',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Export file artifact' } },
    },
  },
  '/internal/v1/insight/projection-rebuilds': {
    post: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Execute a non-blocking shadow-swap projection rebuild from retained analytical fact logs',
      operationId: 'InsightInternal_runRebuild',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Projection rebuild completed' } },
    },
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'List projection rebuild runs',
      operationId: 'InsightInternal_listRebuilds',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of projection rebuild runs' } },
    },
  },
  '/internal/v1/insight/projection-rebuilds/{id}': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'Get projection rebuild run details and verification checksums',
      operationId: 'InsightInternal_getRebuildById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Projection rebuild run details' } },
    },
  },
  '/internal/v1/insight/reconciliation-runs': {
    post: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Execute an analytical reconciliation run comparing summary projections against retained fact baselines',
      operationId: 'InsightInternal_runReconciliation',
      security: [{ bearer: [] }],
      responses: { '201': { description: 'Reconciliation run completed' } },
    },
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary: 'List analytical reconciliation runs',
      operationId: 'InsightInternal_listReconciliations',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'List of reconciliation runs' } },
    },
  },
  '/internal/v1/insight/reconciliation-runs/{id}': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get analytical reconciliation run details and detected discrepancy issues',
      operationId: 'InsightInternal_getReconciliationById',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Reconciliation run details' } },
    },
  },
  '/internal/v1/insight/checkpoints': {
    get: {
      tags: ['Insight — Audit & Analytics'],
      summary:
        'Get projection checkpoint freshness status across all projections',
      operationId: 'InsightInternal_getCheckpoints',
      security: [{ bearer: [] }],
      responses: { '200': { description: 'Projection checkpoints' } },
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
