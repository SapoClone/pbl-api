import * as argon2 from 'argon2';
import { createCipheriv, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

export type ServiceName =
  | 'platform'
  | 'catalog'
  | 'customer'
  | 'inventory'
  | 'sales'
  | 'finance'
  | 'integration'
  | 'insight';

export interface ServiceDbConfig {
  service: ServiceName;
  schema: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: boolean;
}

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce<Record<string, string>>((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) return acc;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      acc[key] = val;
      return acc;
    }, {});
}

export function loadServiceConfigs(rootDir: string): {
  configs: Record<ServiceName, ServiceDbConfig>;
  masterKey: string;
} {
  const neonEnv = parseEnvFile(path.join(rootDir, '.env.neon'));
  const localEnv = parseEnvFile(path.join(rootDir, '.env'));

  const host = neonEnv.NEON_HOST || process.env.NEON_HOST || '';
  const port = Number(neonEnv.NEON_PORT || process.env.NEON_PORT || 5432);
  const database = neonEnv.NEON_DB || process.env.NEON_DB || 'neondb';

  const services: Array<{
    service: ServiceName;
    schema: string;
    user: string;
    pwKey: string;
  }> = [
    {
      service: 'platform',
      schema: 'public',
      user: 'pbl_platform',
      pwKey: 'NEON_PW_PLATFORM',
    },
    {
      service: 'catalog',
      schema: 'catalog',
      user: 'pbl_catalog',
      pwKey: 'NEON_PW_CATALOG',
    },
    {
      service: 'customer',
      schema: 'customer',
      user: 'pbl_customer',
      pwKey: 'NEON_PW_CUSTOMER',
    },
    {
      service: 'inventory',
      schema: 'inventory',
      user: 'pbl_inventory',
      pwKey: 'NEON_PW_INVENTORY',
    },
    {
      service: 'sales',
      schema: 'sales',
      user: 'pbl_sales',
      pwKey: 'NEON_PW_SALES',
    },
    {
      service: 'finance',
      schema: 'finance',
      user: 'pbl_finance',
      pwKey: 'NEON_PW_FINANCE',
    },
    {
      service: 'integration',
      schema: 'integration',
      user: 'pbl_integration',
      pwKey: 'NEON_PW_INTEGRATION',
    },
    {
      service: 'insight',
      schema: 'insight',
      user: 'pbl_insight',
      pwKey: 'NEON_PW_INSIGHT',
    },
  ];

  const configs = {} as Record<ServiceName, ServiceDbConfig>;
  for (const s of services) {
    configs[s.service] = {
      service: s.service,
      schema: s.schema,
      host,
      port,
      database,
      user: s.user,
      password: neonEnv[s.pwKey] || process.env[s.pwKey],
      ssl: true,
    };
  }

  const masterKey =
    neonEnv.INTEGRATION_CREDENTIAL_MASTER_KEY ||
    localEnv.INTEGRATION_CREDENTIAL_MASTER_KEY ||
    process.env.INTEGRATION_CREDENTIAL_MASTER_KEY ||
    'b2d807805d1f7d4843357a1098b53e975e0dacb6245b2742f6b4edf197429843';

  return { configs, masterKey };
}

export async function createServiceClient(
  cfg: ServiceDbConfig,
): Promise<Client> {
  const client = new Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  client.on('error', (err) => {
    console.warn(`[pg client warning - ${cfg.service}]: ${err.message}`);
  });
  await client.connect();
  return client;
}

/**
 * Deterministic UUID v4-shaped identifier from a namespace/key string
 */
export function detUuid(key: string): string {
  const hash = createHash('sha256')
    .update(`pbl6-vn-seed:${key}`, 'utf8')
    .digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    'a' + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

export function sha256Fixed(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function encryptCredentialSecret(
  plaintext: string,
  masterKey: string,
  seedKey: string,
): string {
  const key = createHash('sha256').update(masterKey, 'utf8').digest();
  const iv = createHash('md5')
    .update(`iv:${seedKey}`, 'utf8')
    .digest()
    .subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function normalizeVn(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Execute callback inside a transaction with `app.tenant_id` set for RLS enforcement.
 */
export async function withTenant<T>(
  client: Client,
  tenantId: string | null,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    if (tenantId) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
    }
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Returns YYYY-MM-DD in Asia/Ho_Chi_Minh for today + offsetDays
 */
export function vnDateString(offsetDays = 0, baseDate = new Date()): string {
  const shifted = new Date(baseDate.getTime() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(shifted);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Returns an ISO timestamp at a specific hour/minute in Asia/Ho_Chi_Minh for a YYYY-MM-DD date
 * Clamps hour so that if date is today, it is never in the future relative to current Vietnam hour.
 */
export function vnTimestamp(
  dateStr: string,
  hourVn: number,
  minuteVn = 15,
): string {
  const now = new Date();
  const todayStr = vnDateString(0, now);
  let h = hourVn;
  if (dateStr === todayStr) {
    const currentVnHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        hour12: false,
      }).format(now),
    );
    if (h > currentVnHour) {
      h = Math.max(0, currentVnHour);
    }
  }
  const hh = String(h).padStart(2, '0');
  const mm = String(minuteVn).padStart(2, '0');
  return new Date(`${dateStr}T${hh}:${mm}:00+07:00`).toISOString();
}

export async function hashDefaultPassword(
  password = 'Password@123',
): Promise<string> {
  return argon2.hash(password);
}

// Shared deterministic IDs used across all 8 schemas
export const IDS = {
  // Platform Admins
  superAdmin: detUuid('platform_admin:super_admin'),
  supportAdmin: detUuid('platform_admin:support_admin'),

  // Tenants
  tenant1: detUuid('tenant:vietfashion'),
  tenant2: detUuid('tenant:bachhoasaigon'),

  // Subscriptions
  sub1: detUuid('subscription:vietfashion'),
  sub2: detUuid('subscription:bachhoasaigon'),

  // Branches (Tenant 1: VietFashion)
  branchQ1: detUuid('branch:vietfashion:CN-Q1'),
  branchQ3: detUuid('branch:vietfashion:CN-Q3'),
  branchKhoTb: detUuid('branch:vietfashion:KHO-TB'),

  // Branches (Tenant 2: BachHoaSaiGon)
  branchT2Bt: detUuid('branch:bachhoasaigon:CN-BT'),
  branchT2KhoTd: detUuid('branch:bachhoasaigon:KHO-TD'),

  // Accounts
  accT1Owner: detUuid('account:chu.cuahang@vietfashion.vn'),
  accT1Manager: detUuid('account:quanly.q1@vietfashion.vn'),
  accT1Cashier: detUuid('account:thungan.q1@vietfashion.vn'),
  accT1Warehouse: detUuid('account:thukho.tb@vietfashion.vn'),
  accT1Accountant: detUuid('account:ketoan@vietfashion.vn'),
  accT2Owner: detUuid('account:chu.cuahang@bachhoasaigon.vn'),

  // Roles (Tenant 1)
  roleT1Owner: detUuid('role:t1:owner'),
  roleT1Manager: detUuid('role:t1:branch_manager'),
  roleT1Sales: detUuid('role:t1:sales_staff'),
  roleT1Warehouse: detUuid('role:t1:warehouse_staff'),
  roleT1Accountant: detUuid('role:t1:accountant'),

  // Roles (Tenant 2)
  roleT2Owner: detUuid('role:t2:owner'),
  roleT2Manager: detUuid('role:t2:branch_manager'),
  roleT2Sales: detUuid('role:t2:sales_staff'),
  roleT2Warehouse: detUuid('role:t2:warehouse_staff'),
  roleT2Accountant: detUuid('role:t2:accountant'),

  // Catalog Categories (Tenant 1)
  catNam: detUuid('cat:t1:thoi-trang-nam'),
  catAoThunNam: detUuid('cat:t1:ao-thun-nam'),
  catAoSoMiNam: detUuid('cat:t1:ao-so-mi-nam'),
  catQuanNam: detUuid('cat:t1:quan-jeans-kaki-nam'),
  catNu: detUuid('cat:t1:thoi-trang-nu'),
  catAoNu: detUuid('cat:t1:ao-kieu-nu'),
  catDamNu: detUuid('cat:t1:dam-cong-so-nu'),
  catPhuKien: detUuid('cat:t1:phu-kien-thoi-trang'),

  // Brands (Tenant 1)
  brandCoolmate: detUuid('brand:t1:coolmate'),
  brandRoutine: detUuid('brand:t1:routine'),
  brandYody: detUuid('brand:t1:yody'),
  brandVietTien: detUuid('brand:t1:viettien'),
  brandOwen: detUuid('brand:t1:owen'),

  // Attributes & Values (Tenant 1)
  attrSize: detUuid('attr:t1:size'),
  attrColor: detUuid('attr:t1:color'),
  valSizeS: detUuid('attr_val:t1:size:S'),
  valSizeM: detUuid('attr_val:t1:size:M'),
  valSizeL: detUuid('attr_val:t1:size:L'),
  valSizeXL: detUuid('attr_val:t1:size:XL'),
  valSizeFree: detUuid('attr_val:t1:size:FREESIZE'),
  valColorBlack: detUuid('attr_val:t1:color:DEN'),
  valColorWhite: detUuid('attr_val:t1:color:TRANG'),
  valColorNavy: detUuid('attr_val:t1:color:NAVY'),
  valColorBeige: detUuid('attr_val:t1:color:BE'),

  // Price Lists (Tenant 1)
  plDefault: detUuid('price_list:t1:default'),
  plVip: detUuid('price_list:t1:vip'),
  plBranchQ1: detUuid('price_list:t1:branch_q1'),

  // Customer Groups (Tenant 1)
  cgWalkIn: detUuid('cg:t1:walk_in'),
  cgMember: detUuid('cg:t1:member'),
  cgVip: detUuid('cg:t1:vip'),
  cgWholesale: detUuid('cg:t1:wholesale'),

  // Customer Groups (Tenant 2)
  cgT2WalkIn: detUuid('cg:t2:walk_in'),
  cgT2Member: detUuid('cg:t2:member'),
  cgT2Vip: detUuid('cg:t2:vip'),
  cgT2Wholesale: detUuid('cg:t2:wholesale'),

  // Membership Tiers (Tenant 1)
  tierBronze: detUuid('tier:t1:bronze'),
  tierSilver: detUuid('tier:t1:silver'),
  tierGold: detUuid('tier:t1:gold'),
  tierDiamond: detUuid('tier:t1:diamond'),

  // Warehouses (Tenant 1)
  whTbMain: detUuid('wh:t1:KHO-TB-MAIN'),
  whQ1Main: detUuid('wh:t1:KHO-Q1-MAIN'),
  whQ3Main: detUuid('wh:t1:KHO-Q3-MAIN'),
  whTbQuarantine: detUuid('wh:t1:KHO-TB-LOI'),

  // Suppliers (Tenant 1)
  supVietThang: detUuid('sup:t1:NCC0001'),
  supNamSaiGon: detUuid('sup:t1:NCC0002'),
  supDongA: detUuid('sup:t1:NCC0003'),

  // Sales Channels (Tenant 1)
  chPos: detUuid('channel:t1:pos'),
  chWebsite: detUuid('channel:t1:website'),
  chShopee: detUuid('channel:t1:shopee'),
  chLazada: detUuid('channel:t1:lazada'),
  chTiktok: detUuid('channel:t1:tiktok_shop'),
  chFacebook: detUuid('channel:t1:facebook'),

  // Registers & Shifts (Tenant 1)
  regQ1_01: detUuid('register:t1:Q01'),
  regQ1_02: detUuid('register:t1:Q02'),
  regQ3_01: detUuid('register:t1:Q03'),
  shiftClosed: detUuid('shift:t1:CA000001'),
  shiftOpen: detUuid('shift:t1:CA000002'),

  // Promotions & Coupons
  promoSummer: detUuid('promo:t1:KM_CHAOHE'),
  promoVip: detUuid('promo:t1:KM_VIP10'),
  couponSummer: detUuid('coupon:t1:CHAOHE50K'),
  couponVip: detUuid('coupon:t1:VIP10'),

  // Integration Connections
  connShopee: detUuid('conn:t1:shopee_mall'),
  connLazada: detUuid('conn:t1:lazada_flagship'),
};

export interface CatalogVariantSeed {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  skuCode: string;
  barcode: string;
  imageUrl: string;
  categoryId: string;
  brandId: string;
  baseUnit: string;
  unitCost: number;
  basePrice: number;
  vipPrice: number;
  q1Price: number;
  weightGrams: number;
  combinationSignature: string;
  isDefault: boolean;
  sizeValueId: string;
  colorValueId: string;
  initialQtyTb: number;
  initialQtyQ1: number;
  initialQtyQ3: number;
}

export const CATALOG_PRODUCTS: Array<{
  productId: string;
  code: string;
  name: string;
  description: string;
  imageUrl: string;
  categoryId: string;
  brandId: string;
  baseUnit: string;
  variants: CatalogVariantSeed[];
}> = [
  {
    productId: detUuid('product:t1:SP000001'),
    code: 'SP000001',
    name: 'Áo Polo Nam Coolmate Excool Khử Mùi',
    description:
      'Áo Polo nam chất liệu sợi Sorona kết hợp Excool thoáng khí, co giãn 4 chiều, chống tia UV UPF 50+.',
    imageUrl:
      'https://images.unsplash.com/photo-1586363104862-3a5e2ab60d99?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catAoThunNam,
    brandId: IDS.brandCoolmate,
    baseUnit: 'Cái',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000001-M-DEN'),
        productId: detUuid('product:t1:SP000001'),
        productName: 'Áo Polo Nam Coolmate Excool Khử Mùi',
        variantName: 'Áo Polo Nam Coolmate Excool Khử Mùi - Đen / Size M',
        skuCode: 'POLO-CM-DEN-M',
        barcode: '8938505974016',
        imageUrl:
          'https://images.unsplash.com/photo-1586363104862-3a5e2ab60d99?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoThunNam,
        brandId: IDS.brandCoolmate,
        baseUnit: 'Cái',
        unitCost: 165000,
        basePrice: 299000,
        vipPrice: 269000,
        q1Price: 289000,
        weightGrams: 220,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBlack}|${IDS.attrSize}:${IDS.valSizeM}`,
        isDefault: true,
        sizeValueId: IDS.valSizeM,
        colorValueId: IDS.valColorBlack,
        initialQtyTb: 120,
        initialQtyQ1: 45,
        initialQtyQ3: 30,
      },
      {
        variantId: detUuid('variant:t1:SP000001-L-DEN'),
        productId: detUuid('product:t1:SP000001'),
        productName: 'Áo Polo Nam Coolmate Excool Khử Mùi',
        variantName: 'Áo Polo Nam Coolmate Excool Khử Mùi - Đen / Size L',
        skuCode: 'POLO-CM-DEN-L',
        barcode: '8938505974023',
        imageUrl:
          'https://images.unsplash.com/photo-1586363104862-3a5e2ab60d99?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoThunNam,
        brandId: IDS.brandCoolmate,
        baseUnit: 'Cái',
        unitCost: 165000,
        basePrice: 299000,
        vipPrice: 269000,
        q1Price: 289000,
        weightGrams: 235,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBlack}|${IDS.attrSize}:${IDS.valSizeL}`,
        isDefault: false,
        sizeValueId: IDS.valSizeL,
        colorValueId: IDS.valColorBlack,
        initialQtyTb: 100,
        initialQtyQ1: 40,
        initialQtyQ3: 25,
      },
      {
        variantId: detUuid('variant:t1:SP000001-XL-NAVY'),
        productId: detUuid('product:t1:SP000001'),
        productName: 'Áo Polo Nam Coolmate Excool Khử Mùi',
        variantName:
          'Áo Polo Nam Coolmate Excool Khử Mùi - Xanh Navy / Size XL',
        skuCode: 'POLO-CM-NAVY-XL',
        barcode: '8938505974030',
        imageUrl:
          'https://images.unsplash.com/photo-1586363104862-3a5e2ab60d99?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoThunNam,
        brandId: IDS.brandCoolmate,
        baseUnit: 'Cái',
        unitCost: 165000,
        basePrice: 299000,
        vipPrice: 269000,
        q1Price: 289000,
        weightGrams: 250,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorNavy}|${IDS.attrSize}:${IDS.valSizeXL}`,
        isDefault: false,
        sizeValueId: IDS.valSizeXL,
        colorValueId: IDS.valColorNavy,
        initialQtyTb: 80,
        initialQtyQ1: 35,
        initialQtyQ3: 20,
      },
    ],
  },
  {
    productId: detUuid('product:t1:SP000002'),
    code: 'SP000002',
    name: 'Áo Sơ Mi Nam Việt Tiến Dài Tay Bamboo',
    description:
      'Áo sơ mi nam công sở cao cấp vải sợi tre thiên nhiên kháng khuẩn, ít nhăn, phom Regular Fit lịch lãm.',
    imageUrl:
      'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catAoSoMiNam,
    brandId: IDS.brandVietTien,
    baseUnit: 'Cái',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000002-M-TRANG'),
        productId: detUuid('product:t1:SP000002'),
        productName: 'Áo Sơ Mi Nam Việt Tiến Dài Tay Bamboo',
        variantName: 'Áo Sơ Mi Nam Việt Tiến Dài Tay Bamboo - Trắng / Size M',
        skuCode: 'SOMI-VT-TRANG-M',
        barcode: '8938505974047',
        imageUrl:
          'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoSoMiNam,
        brandId: IDS.brandVietTien,
        baseUnit: 'Cái',
        unitCost: 260000,
        basePrice: 450000,
        vipPrice: 405000,
        q1Price: 435000,
        weightGrams: 280,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorWhite}|${IDS.attrSize}:${IDS.valSizeM}`,
        isDefault: true,
        sizeValueId: IDS.valSizeM,
        colorValueId: IDS.valColorWhite,
        initialQtyTb: 90,
        initialQtyQ1: 30,
        initialQtyQ3: 25,
      },
      {
        variantId: detUuid('variant:t1:SP000002-L-TRANG'),
        productId: detUuid('product:t1:SP000002'),
        productName: 'Áo Sơ Mi Nam Việt Tiến Dài Tay Bamboo',
        variantName: 'Áo Sơ Mi Nam Việt Tiến Dài Tay Bamboo - Trắng / Size L',
        skuCode: 'SOMI-VT-TRANG-L',
        barcode: '8938505974054',
        imageUrl:
          'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoSoMiNam,
        brandId: IDS.brandVietTien,
        baseUnit: 'Cái',
        unitCost: 260000,
        basePrice: 450000,
        vipPrice: 405000,
        q1Price: 435000,
        weightGrams: 295,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorWhite}|${IDS.attrSize}:${IDS.valSizeL}`,
        isDefault: false,
        sizeValueId: IDS.valSizeL,
        colorValueId: IDS.valColorWhite,
        initialQtyTb: 85,
        initialQtyQ1: 30,
        initialQtyQ3: 20,
      },
    ],
  },
  {
    productId: detUuid('product:t1:SP000003'),
    code: 'SP000003',
    name: 'Quần Jeans Nam Routine Slimfit Co Giãn',
    description:
      'Quần Jeans nam phom Slimfit tôn dáng, chất vải Denim Cotton pha Spandex co giãn thoải mái cả ngày.',
    imageUrl:
      'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catQuanNam,
    brandId: IDS.brandRoutine,
    baseUnit: 'Quần',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000003-M-NAVY'),
        productId: detUuid('product:t1:SP000003'),
        productName: 'Quần Jeans Nam Routine Slimfit Co Giãn',
        variantName:
          'Quần Jeans Nam Routine Slimfit Co Giãn - Xanh Navy / Size M',
        skuCode: 'JEAN-RT-NAVY-M',
        barcode: '8938505974061',
        imageUrl:
          'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catQuanNam,
        brandId: IDS.brandRoutine,
        baseUnit: 'Quần',
        unitCost: 320000,
        basePrice: 590000,
        vipPrice: 531000,
        q1Price: 570000,
        weightGrams: 550,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorNavy}|${IDS.attrSize}:${IDS.valSizeM}`,
        isDefault: true,
        sizeValueId: IDS.valSizeM,
        colorValueId: IDS.valColorNavy,
        initialQtyTb: 70,
        initialQtyQ1: 25,
        initialQtyQ3: 20,
      },
      {
        variantId: detUuid('variant:t1:SP000003-L-DEN'),
        productId: detUuid('product:t1:SP000003'),
        productName: 'Quần Jeans Nam Routine Slimfit Co Giãn',
        variantName: 'Quần Jeans Nam Routine Slimfit Co Giãn - Đen / Size L',
        skuCode: 'JEAN-RT-DEN-L',
        barcode: '8938505974078',
        imageUrl:
          'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catQuanNam,
        brandId: IDS.brandRoutine,
        baseUnit: 'Quần',
        unitCost: 320000,
        basePrice: 590000,
        vipPrice: 531000,
        q1Price: 570000,
        weightGrams: 580,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBlack}|${IDS.attrSize}:${IDS.valSizeL}`,
        isDefault: false,
        sizeValueId: IDS.valSizeL,
        colorValueId: IDS.valColorBlack,
        initialQtyTb: 65,
        initialQtyQ1: 25,
        initialQtyQ3: 15,
      },
    ],
  },
  {
    productId: detUuid('product:t1:SP000004'),
    code: 'SP000004',
    name: 'Áo Thun Nữ Yody Cotton Compact Mềm Mịn',
    description:
      'Áo phông nữ cổ tròn chất liệu Cotton Compact 95% thấm hút mồ hôi vượt trội, không xù lông.',
    imageUrl:
      'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catAoNu,
    brandId: IDS.brandYody,
    baseUnit: 'Cái',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000004-S-TRANG'),
        productId: detUuid('product:t1:SP000004'),
        productName: 'Áo Thun Nữ Yody Cotton Compact Mềm Mịn',
        variantName: 'Áo Thun Nữ Yody Cotton Compact Mềm Mịn - Trắng / Size S',
        skuCode: 'THUN-YD-TRANG-S',
        barcode: '8938505974085',
        imageUrl:
          'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoNu,
        brandId: IDS.brandYody,
        baseUnit: 'Cái',
        unitCost: 120000,
        basePrice: 229000,
        vipPrice: 206000,
        q1Price: 219000,
        weightGrams: 180,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorWhite}|${IDS.attrSize}:${IDS.valSizeS}`,
        isDefault: true,
        sizeValueId: IDS.valSizeS,
        colorValueId: IDS.valColorWhite,
        initialQtyTb: 110,
        initialQtyQ1: 40,
        initialQtyQ3: 35,
      },
      {
        variantId: detUuid('variant:t1:SP000004-M-BE'),
        productId: detUuid('product:t1:SP000004'),
        productName: 'Áo Thun Nữ Yody Cotton Compact Mềm Mịn',
        variantName: 'Áo Thun Nữ Yody Cotton Compact Mềm Mịn - Be / Size M',
        skuCode: 'THUN-YD-BE-M',
        barcode: '8938505974092',
        imageUrl:
          'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoNu,
        brandId: IDS.brandYody,
        baseUnit: 'Cái',
        unitCost: 120000,
        basePrice: 229000,
        vipPrice: 206000,
        q1Price: 219000,
        weightGrams: 190,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBeige}|${IDS.attrSize}:${IDS.valSizeM}`,
        isDefault: false,
        sizeValueId: IDS.valSizeM,
        colorValueId: IDS.valColorBeige,
        initialQtyTb: 95,
        initialQtyQ1: 35,
        initialQtyQ3: 30,
      },
    ],
  },
  {
    productId: detUuid('product:t1:SP000005'),
    code: 'SP000005',
    name: 'Đầm Công Sở Nữ Routine Dáng Chữ A Thanh Lịch',
    description:
      'Đầm liền công sở dáng chữ A chiết eo nhẹ, chất vải Tuytsi cao cấp đứng phom, có lớp lót lụa mềm.',
    imageUrl:
      'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catDamNu,
    brandId: IDS.brandRoutine,
    baseUnit: 'Chiếc',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000005-S-BE'),
        productId: detUuid('product:t1:SP000005'),
        productName: 'Đầm Công Sở Nữ Routine Dáng Chữ A Thanh Lịch',
        variantName: 'Đầm Công Sở Nữ Routine Dáng Chữ A - Be / Size S',
        skuCode: 'DAM-RT-BE-S',
        barcode: '8938505974108',
        imageUrl:
          'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catDamNu,
        brandId: IDS.brandRoutine,
        baseUnit: 'Chiếc',
        unitCost: 380000,
        basePrice: 680000,
        vipPrice: 612000,
        q1Price: 650000,
        weightGrams: 420,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBeige}|${IDS.attrSize}:${IDS.valSizeS}`,
        isDefault: true,
        sizeValueId: IDS.valSizeS,
        colorValueId: IDS.valColorBeige,
        initialQtyTb: 60,
        initialQtyQ1: 20,
        initialQtyQ3: 18,
      },
      {
        variantId: detUuid('variant:t1:SP000005-M-DEN'),
        productId: detUuid('product:t1:SP000005'),
        productName: 'Đầm Công Sở Nữ Routine Dáng Chữ A Thanh Lịch',
        variantName: 'Đầm Công Sở Nữ Routine Dáng Chữ A - Đen / Size M',
        skuCode: 'DAM-RT-DEN-M',
        barcode: '8938505974115',
        imageUrl:
          'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catDamNu,
        brandId: IDS.brandRoutine,
        baseUnit: 'Chiếc',
        unitCost: 380000,
        basePrice: 680000,
        vipPrice: 612000,
        q1Price: 650000,
        weightGrams: 440,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBlack}|${IDS.attrSize}:${IDS.valSizeM}`,
        isDefault: false,
        sizeValueId: IDS.valSizeM,
        colorValueId: IDS.valColorBlack,
        initialQtyTb: 55,
        initialQtyQ1: 20,
        initialQtyQ3: 6, // below_min (< 10) at Q3
      },
    ],
  },
  {
    productId: detUuid('product:t1:SP000006'),
    code: 'SP000006',
    name: 'Áo Khoác Gió Unisex Chống Tia UV Yody',
    description:
      'Áo khoác gió 2 lớp trượt nước, cản gió, chống nắng UPF 50+, gấp gọn tiện lợi khi di chuyển.',
    imageUrl:
      'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catAoThunNam,
    brandId: IDS.brandYody,
    baseUnit: 'Cái',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000006-L-NAVY'),
        productId: detUuid('product:t1:SP000006'),
        productName: 'Áo Khoác Gió Unisex Chống Tia UV Yody',
        variantName:
          'Áo Khoác Gió Unisex Chống Tia UV Yody - Xanh Navy / Size L',
        skuCode: 'KHOAC-YD-NAVY-L',
        barcode: '8938505974122',
        imageUrl:
          'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catAoThunNam,
        brandId: IDS.brandYody,
        baseUnit: 'Cái',
        unitCost: 280000,
        basePrice: 499000,
        vipPrice: 449000,
        q1Price: 479000,
        weightGrams: 350,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorNavy}|${IDS.attrSize}:${IDS.valSizeL}`,
        isDefault: true,
        sizeValueId: IDS.valSizeL,
        colorValueId: IDS.valColorNavy,
        initialQtyTb: 75,
        initialQtyQ1: 28,
        initialQtyQ3: 22,
      },
    ],
  },
  {
    productId: detUuid('product:t1:SP000007'),
    code: 'SP000007',
    name: 'Balo Laptop Canvas Chống Thấm 15.6 inch',
    description:
      'Balo thời trang vải Canvas phối da PU chống thấm nước, ngăn chống sốc đựng vừa laptop 15.6 inch.',
    imageUrl:
      'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catPhuKien,
    brandId: IDS.brandRoutine,
    baseUnit: 'Chiếc',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000007-FREE-DEN'),
        productId: detUuid('product:t1:SP000007'),
        productName: 'Balo Laptop Canvas Chống Thấm 15.6 inch',
        variantName: 'Balo Laptop Canvas Chống Thấm 15.6 inch - Đen / Freesize',
        skuCode: 'BALO-CV-DEN-FS',
        barcode: '8938505974139',
        imageUrl:
          'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catPhuKien,
        brandId: IDS.brandRoutine,
        baseUnit: 'Chiếc',
        unitCost: 240000,
        basePrice: 420000,
        vipPrice: 378000,
        q1Price: 399000,
        weightGrams: 680,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBlack}|${IDS.attrSize}:${IDS.valSizeFree}`,
        isDefault: true,
        sizeValueId: IDS.valSizeFree,
        colorValueId: IDS.valColorBlack,
        initialQtyTb: 50,
        initialQtyQ1: 18,
        initialQtyQ3: 5, // below_min (< 10) at Q3
      },
    ],
  },
  {
    productId: detUuid('product:t1:SP000008'),
    code: 'SP000008',
    name: 'Thắt Lưng Da Bò Nam Khóa Tự Động Owen',
    description:
      'Dây lưng nam da bò thật nguyên tấm 100%, mặt khóa hợp kim chống gỉ sét sang trọng.',
    imageUrl:
      'https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=600&q=80',
    categoryId: IDS.catPhuKien,
    brandId: IDS.brandOwen,
    baseUnit: 'Chiếc',
    variants: [
      {
        variantId: detUuid('variant:t1:SP000008-FREE-DEN'),
        productId: detUuid('product:t1:SP000008'),
        productName: 'Thắt Lưng Da Bò Nam Khóa Tự Động Owen',
        variantName: 'Thắt Lưng Da Bò Nam Khóa Tự Động Owen - Đen / Freesize',
        skuCode: 'TLUNG-OW-DEN-FS',
        barcode: '8938505974146',
        imageUrl:
          'https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=600&q=80',
        categoryId: IDS.catPhuKien,
        brandId: IDS.brandOwen,
        baseUnit: 'Chiếc',
        unitCost: 190000,
        basePrice: 350000,
        vipPrice: 315000,
        q1Price: 335000,
        weightGrams: 300,
        combinationSignature: `${IDS.attrColor}:${IDS.valColorBlack}|${IDS.attrSize}:${IDS.valSizeFree}`,
        isDefault: true,
        sizeValueId: IDS.valSizeFree,
        colorValueId: IDS.valColorBlack,
        initialQtyTb: 60,
        initialQtyQ1: 22,
        initialQtyQ3: 0, // out_of_stock (= 0) at Q3
      },
    ],
  },
];

export const ALL_VARIANTS: CatalogVariantSeed[] = CATALOG_PRODUCTS.flatMap(
  (p) => p.variants,
);
