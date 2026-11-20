import { Client } from 'pg';
import {
  ALL_VARIANTS,
  CATALOG_PRODUCTS,
  IDS,
  detUuid,
  hashDefaultPassword,
  normalizeVn,
  vnDateString,
  withTenant,
} from './helpers';

const ALL_PERMISSIONS = [
  'channels.create',
  'channels.delete',
  'channels.update',
  'channels.view',
  'customers.create',
  'customers.delete',
  'customers.update',
  'customers.view',
  'dashboard.view',
  'finance.approve',
  'finance.create',
  'finance.update',
  'finance.view',
  'inventory.approve',
  'inventory.create',
  'inventory.delete',
  'inventory.update',
  'inventory.view',
  'orders.approve',
  'orders.create',
  'orders.delete',
  'orders.update',
  'orders.view',
  'pos.approve',
  'pos.create',
  'pos.update',
  'pos.view',
  'products.create',
  'products.delete',
  'products.update',
  'products.view',
  'purchasing.approve',
  'purchasing.create',
  'purchasing.delete',
  'purchasing.update',
  'purchasing.view',
  'reports.view',
  'settings.update',
  'settings.view',
  'staff.create',
  'staff.delete',
  'staff.update',
  'staff.view',
];

export const CUSTOMERS_SEED = [
  {
    id: detUuid('customer:t1:KH000001'),
    code: 'KH000001',
    memberCode: 'VIP-2026-001',
    groupId: IDS.cgVip,
    tierId: IDS.tierGold,
    name: 'Trần Thị Minh Ngọc',
    phone: '0903112233',
    email: 'minhngoc.tran@gmail.com',
    gender: 'FEMALE',
    dob: '1993-04-15',
    source: 'POS',
    debtLimit: 10000000,
    currentDebt: 0,
    address: 'Số 86 Lê Thánh Tôn',
    ward: 'Phường Bến Nghé',
    district: 'Quận 1',
    province: 'TP. Hồ Chí Minh',
    points: 1450,
    lifetimeEarned: 1650,
    lifetimeRedeemed: 200,
  },
  {
    id: detUuid('customer:t1:KH000002'),
    code: 'KH000002',
    memberCode: 'VIP-2026-002',
    groupId: IDS.cgVip,
    tierId: IDS.tierDiamond,
    name: 'Nguyễn Hoàng Phúc',
    phone: '0918223344',
    email: 'hoangphuc.nguyen@vnpt.vn',
    gender: 'MALE',
    dob: '1988-11-20',
    source: 'POS',
    debtLimit: 20000000,
    currentDebt: 0,
    address: 'Số 142 Nguyễn Đình Chiểu',
    ward: 'Phường Võ Thị Sáu',
    district: 'Quận 3',
    province: 'TP. Hồ Chí Minh',
    points: 2850,
    lifetimeEarned: 3100,
    lifetimeRedeemed: 250,
  },
  {
    id: detUuid('customer:t1:KH000003'),
    code: 'KH000003',
    memberCode: 'MEM-2026-003',
    groupId: IDS.cgMember,
    tierId: IDS.tierSilver,
    name: 'Lê Quang Khải',
    phone: '0989334455',
    email: 'quangkhai.le@fpt.com.vn',
    gender: 'MALE',
    dob: '1996-07-08',
    source: 'WEBSITE',
    debtLimit: 5000000,
    currentDebt: 0,
    address: 'Số 25 Phan Xích Long',
    ward: 'Phường 2',
    district: 'Quận Phú Nhuận',
    province: 'TP. Hồ Chí Minh',
    points: 520,
    lifetimeEarned: 520,
    lifetimeRedeemed: 0,
  },
  {
    id: detUuid('customer:t1:KH000004'),
    code: 'KH000004',
    memberCode: 'MEM-2026-004',
    groupId: IDS.cgMember,
    tierId: IDS.tierBronze,
    name: 'Phạm Thu Hà',
    phone: '0977445566',
    email: 'thuha.pham98@gmail.com',
    gender: 'FEMALE',
    dob: '1998-02-14',
    source: 'SHOPEE',
    debtLimit: 2000000,
    currentDebt: 0,
    address: 'Chung cư Vinhomes Central Park, Điện Biên Phủ',
    ward: 'Phường 22',
    district: 'Quận Bình Thạnh',
    province: 'TP. Hồ Chí Minh',
    points: 180,
    lifetimeEarned: 180,
    lifetimeRedeemed: 0,
  },
  {
    id: detUuid('customer:t1:KH000005'),
    code: 'KH000005',
    memberCode: 'WS-2026-005',
    groupId: IDS.cgWholesale,
    tierId: IDS.tierGold,
    name: 'Đỗ Văn Hùng (Shop Thời Trang Hùng Phát)',
    phone: '0909556677',
    email: 'hungphat.fashion@gmail.com',
    gender: 'MALE',
    dob: '1985-09-10',
    source: 'POS',
    debtLimit: 50000000,
    currentDebt: 2450000,
    address: 'Số 310 Hai Bà Trưng',
    ward: 'Phường Tân Định',
    district: 'Quận 1',
    province: 'TP. Hồ Chí Minh',
    points: 1200,
    lifetimeEarned: 1200,
    lifetimeRedeemed: 0,
  },
  {
    id: detUuid('customer:t1:KH000006'),
    code: 'KH000006',
    memberCode: 'MEM-2026-006',
    groupId: IDS.cgMember,
    tierId: IDS.tierSilver,
    name: 'Vũ Thị Lan Anh',
    phone: '0938667788',
    email: 'lananh.vu@vietcombank.com.vn',
    gender: 'FEMALE',
    dob: '1994-12-03',
    source: 'LAZADA',
    debtLimit: 5000000,
    currentDebt: 0,
    address: 'Số 18 Hoàng Hoa Thám',
    ward: 'Phường 12',
    district: 'Quận Tân Bình',
    province: 'TP. Hồ Chí Minh',
    points: 410,
    lifetimeEarned: 410,
    lifetimeRedeemed: 0,
  },
  {
    id: detUuid('customer:t1:KH000007'),
    code: 'KH000007',
    memberCode: null,
    groupId: IDS.cgWalkIn,
    tierId: IDS.tierBronze,
    name: 'Bùi Thanh Tùng',
    phone: '0945778899',
    email: 'thanhtung.bui@gmail.com',
    gender: 'MALE',
    dob: '2000-05-25',
    source: 'POS',
    debtLimit: 2000000,
    currentDebt: 0,
    address: 'Số 52 Nguyễn Thị Minh Khai',
    ward: 'Phường Đa Kao',
    district: 'Quận 1',
    province: 'TP. Hồ Chí Minh',
    points: 90,
    lifetimeEarned: 90,
    lifetimeRedeemed: 0,
  },
  {
    id: detUuid('customer:t1:KH000008'),
    code: 'KH000008',
    memberCode: 'MEM-2026-008',
    groupId: IDS.cgMember,
    tierId: IDS.tierBronze,
    name: 'Hoàng Bảo Châu',
    phone: '0966889900',
    email: 'baochau.hoang@gmail.com',
    gender: 'FEMALE',
    dob: '1999-08-19',
    source: 'TIKTOK_SHOP',
    debtLimit: 2000000,
    currentDebt: 0,
    address: 'Số 78 Cách Mạng Tháng Tám',
    ward: 'Phường 6',
    district: 'Quận 3',
    province: 'TP. Hồ Chí Minh',
    points: 110,
    lifetimeEarned: 110,
    lifetimeRedeemed: 0,
  },
];

export async function seedPlatform(client: Client): Promise<void> {
  const passwordHash = await hashDefaultPassword('Password@123');
  const today = vnDateString(0);
  const periodStart = vnDateString(-15);
  const periodEnd = vnDateString(15);

  await client.query('BEGIN');
  try {
    // 1. Update/insert plans with Vietnamese names & descriptions
    const plans = [
      {
        id: detUuid('plan:free'),
        code: 'free',
        name: 'Gói Khởi Đầu (Miễn Phí)',
        description:
          'Dành cho cửa hàng nhỏ mới bắt đầu chuyển đổi số quản lý bán hàng.',
        priceMonthly: 0,
        isFeatured: false,
        branches: 1,
        users: 3,
        products: 100,
        storageMb: 512,
      },
      {
        id: detUuid('plan:basic'),
        code: 'basic',
        name: 'Gói Cơ Bản (Basic)',
        description:
          'Phù hợp cho cửa hàng bán lẻ có từ 1-3 chi nhánh và bán hàng đa kênh.',
        priceMonthly: 299000,
        isFeatured: false,
        branches: 3,
        users: 15,
        products: 2000,
        storageMb: 5120,
      },
      {
        id: detUuid('plan:pro'),
        code: 'pro',
        name: 'Gói Chuyên Nghiệp (Pro)',
        description:
          'Giải pháp toàn diện cho chuỗi cửa hàng thời trang, siêu thị mini, tích hợp sàn TMĐT & phân tích chuyên sâu.',
        priceMonthly: 799000,
        isFeatured: true,
        branches: 10,
        users: 100,
        products: 20000,
        storageMb: 51200,
      },
    ];

    const planIdByCode: Record<string, string> = {};
    for (const p of plans) {
      const res = await client.query(
        `INSERT INTO public.plan (
          id, code, name, description, price_monthly, status, is_featured,
          quota_branches, quota_users, quota_products, quota_storage_mb, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,'system','system')
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          price_monthly = EXCLUDED.price_monthly,
          is_featured = EXCLUDED.is_featured,
          quota_branches = EXCLUDED.quota_branches,
          quota_users = EXCLUDED.quota_users,
          quota_products = EXCLUDED.quota_products,
          quota_storage_mb = EXCLUDED.quota_storage_mb,
          updated_at = now()
        RETURNING id`,
        [
          p.id,
          p.code,
          p.name,
          p.description,
          p.priceMonthly,
          p.isFeatured,
          p.branches,
          p.users,
          p.products,
          p.storageMb,
        ],
      );
      planIdByCode[p.code] = res.rows[0].id;
    }

    // 2. Platform Admins
    const admins = [
      {
        id: IDS.superAdmin,
        email: 'admin@omniretail.vn',
        name: 'Nguyễn Quản Trị Hệ Thống',
        role: 'super_admin',
      },
      {
        id: IDS.supportAdmin,
        email: 'support@omniretail.vn',
        name: 'Trần Hỗ Trợ Vận Hành',
        role: 'admin',
      },
    ];
    for (const a of admins) {
      await client.query(
        `INSERT INTO public.platform_admin (
          id, email, password, name, role, status, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,'active','system','system')
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          password = EXCLUDED.password,
          status = 'active',
          updated_at = now()`,
        [a.id, a.email, passwordHash, a.name, a.role],
      );
    }

    // 3. Platform Settings
    const settings = [
      {
        key: 'general',
        value: {
          platformName: 'OmniRetail Cloud Việt Nam',
          supportEmail: 'hotro@omniretail.vn',
          supportHotline: '1900 6886',
          defaultCurrency: 'VND',
          defaultTimezone: 'Asia/Ho_Chi_Minh',
          maintenanceMode: false,
        },
      },
      {
        key: 'security',
        value: {
          maxFailedLoginAttempts: 5,
          lockoutDurationMinutes: 15,
          sessionTimeoutMinutes: 480,
        },
      },
    ];
    for (const s of settings) {
      await client.query(
        `INSERT INTO public.platform_setting (key, value, updated_by)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [s.key, JSON.stringify(s.value), IDS.superAdmin],
      );
    }

    // 4. Tenants
    const tenants = [
      {
        id: IDS.tenant1,
        code: 'DN0001',
        name: 'Thời Trang Việt (VietFashion)',
        subdomain: 'vietfashion',
        phone: '02838228899',
        email: 'lienhe@vietfashion.vn',
        address:
          'Số 128 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
      },
      {
        id: IDS.tenant2,
        code: 'DN0002',
        name: 'Bách Hóa Sài Gòn',
        subdomain: 'bachhoasaigon',
        phone: '02838991122',
        email: 'cskh@bachhoasaigon.vn',
        address:
          'Số 215 Điện Biên Phủ, Phường 15, Quận Bình Thạnh, TP. Hồ Chí Minh',
      },
    ];
    for (const t of tenants) {
      await client.query(
        `INSERT INTO public.tenant (
          id, code, name, subdomain, phone, email, address, status, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active','system','system')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          address = EXCLUDED.address,
          status = 'active',
          updated_at = now()`,
        [t.id, t.code, t.name, t.subdomain, t.phone, t.email, t.address],
      );
    }

    // 5. Subscriptions, Events, Payments, Usage
    const subs = [
      {
        id: IDS.sub1,
        code: 'SUB0001',
        tenantId: IDS.tenant1,
        planId: planIdByCode['pro'],
        planCode: 'pro',
        amount: 799000,
        payCode: 'TT0001',
        eventId: detUuid('sub_event:t1:1'),
        payId: detUuid('sub_payment:t1:1'),
        branchesUsed: 3,
        usersUsed: 5,
        productsUsed: 8,
        storageMbUsed: 125,
      },
      {
        id: IDS.sub2,
        code: 'SUB0002',
        tenantId: IDS.tenant2,
        planId: planIdByCode['basic'],
        planCode: 'basic',
        amount: 299000,
        payCode: 'TT0002',
        eventId: detUuid('sub_event:t2:1'),
        payId: detUuid('sub_payment:t2:1'),
        branchesUsed: 2,
        usersUsed: 1,
        productsUsed: 0,
        storageMbUsed: 15,
      },
    ];

    for (const s of subs) {
      await client.query(
        `INSERT INTO public.subscription (
          id, code, tenant_id, plan_id, billing_cycle, status, started_at, expires_at, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,'monthly','active', now() - interval '15 days', now() + interval '350 days', 'system', 'system')
        ON CONFLICT (id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = 'active',
          updated_at = now()`,
        [s.id, s.code, s.tenantId, s.planId],
      );

      await client.query(
        `INSERT INTO public.subscription_event (
          id, subscription_id, tenant_id, event_type, plan_code, effective_until, actor_type, actor_id, note
        ) VALUES ($1,$2,$3,'created',$4,$5,'platform_admin',$6,'Kích hoạt gói cước chính thức cho doanh nghiệp')
        ON CONFLICT (id) DO NOTHING`,
        [s.eventId, s.id, s.tenantId, s.planCode, periodEnd, IDS.superAdmin],
      );

      await client.query(
        `INSERT INTO public.subscription_payment (
          id, code, subscription_id, tenant_id, amount, method, status, period_start, period_end, paid_at, note, created_by
        ) VALUES ($1,$2,$3,$4,$5,'transfer','paid',$6,$7,now() - interval '15 days','Thanh toán chuyển khoản ngân hàng Vietcombank','system')
        ON CONFLICT (id) DO NOTHING`,
        [
          s.payId,
          s.payCode,
          s.id,
          s.tenantId,
          s.amount,
          periodStart,
          periodEnd,
        ],
      );

      await client.query(
        `INSERT INTO public.tenant_usage (
          tenant_id, branches_used, users_used, products_used, storage_mb_used, updated_at
        ) VALUES ($1,$2,$3,$4,$5,now())
        ON CONFLICT (tenant_id) DO UPDATE SET
          branches_used = EXCLUDED.branches_used,
          users_used = EXCLUDED.users_used,
          products_used = EXCLUDED.products_used,
          storage_mb_used = EXCLUDED.storage_mb_used,
          updated_at = now()`,
        [
          s.tenantId,
          s.branchesUsed,
          s.usersUsed,
          s.productsUsed,
          s.storageMbUsed,
        ],
      );
    }

    // 6. Branches & Branch Settings
    const branches = [
      {
        id: IDS.branchQ1,
        tenantId: IDS.tenant1,
        code: 'CN-Q1',
        name: 'Chi nhánh Quận 1 - Nguyễn Trãi',
        address:
          'Số 128 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
        phone: '02838228891',
        isWarehouse: true,
        prefix: 'HDQ1',
      },
      {
        id: IDS.branchQ3,
        tenantId: IDS.tenant1,
        code: 'CN-Q3',
        name: 'Chi nhánh Quận 3 - Lê Văn Sỹ',
        address: 'Số 245 Lê Văn Sỹ, Phường 14, Quận 3, TP. Hồ Chí Minh',
        phone: '02838228892',
        isWarehouse: true,
        prefix: 'HDQ3',
      },
      {
        id: IDS.branchKhoTb,
        tenantId: IDS.tenant1,
        code: 'KHO-TB',
        name: 'Kho Tổng Tân Bình',
        address: 'Số 45 Cộng Hòa, Phường 4, Quận Tân Bình, TP. Hồ Chí Minh',
        phone: '02838228893',
        isWarehouse: true,
        prefix: 'HDTB',
      },
      {
        id: IDS.branchT2Bt,
        tenantId: IDS.tenant2,
        code: 'CN-BT',
        name: 'Chi nhánh Bình Thạnh',
        address:
          'Số 215 Điện Biên Phủ, Phường 15, Quận Bình Thạnh, TP. Hồ Chí Minh',
        phone: '02838991123',
        isWarehouse: true,
        prefix: 'HDBT',
      },
      {
        id: IDS.branchT2KhoTd,
        tenantId: IDS.tenant2,
        code: 'KHO-TD',
        name: 'Kho Tổng Thủ Đức',
        address:
          'Số 88 Võ Văn Ngân, Phường Bình Thọ, TP. Thủ Đức, TP. Hồ Chí Minh',
        phone: '02838991124',
        isWarehouse: true,
        prefix: 'HDTD',
      },
    ];

    for (const b of branches) {
      await client.query(
        `INSERT INTO public.branch (
          id, tenant_id, name, code, address, phone, is_warehouse, status, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active','system','system')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          phone = EXCLUDED.phone,
          is_warehouse = EXCLUDED.is_warehouse,
          status = 'active',
          updated_at = now()`,
        [b.id, b.tenantId, b.name, b.code, b.address, b.phone, b.isWarehouse],
      );

      await client.query(
        `INSERT INTO public.branch_setting (
          id, tenant_id, branch_id, invoice_prefix, invoice_template_code, default_tax_rate,
          allowed_payment_methods, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,'A5_STANDARD',0,'{cash,transfer,card}','system','system')
        ON CONFLICT (id) DO UPDATE SET
          invoice_prefix = EXCLUDED.invoice_prefix,
          updated_at = now()`,
        [detUuid(`branch_setting:${b.id}`), b.tenantId, b.id, b.prefix],
      );
    }

    // 7. Roles & Permissions (matching @pbl/contracts DEFAULT_ROLE_PERMISSIONS)
    const roleConfigs: Array<{
      id: string;
      tenantId: string;
      code: string;
      name: string;
      desc: string;
      perms: string[];
    }> = [
      {
        id: IDS.roleT1Owner,
        tenantId: IDS.tenant1,
        code: 'owner',
        name: 'Chủ cửa hàng',
        desc: 'Toàn quyền với cửa hàng, không thể chỉnh sửa.',
        perms: [], // owner gets wildcard ['*'] automatically, 0 rows in role_permission
      },
      {
        id: IDS.roleT1Manager,
        tenantId: IDS.tenant1,
        code: 'branch_manager',
        name: 'Quản lý chi nhánh',
        desc: 'Quản lý vận hành chi nhánh, trừ quản lý nhân viên và cài đặt cửa hàng.',
        perms: ALL_PERMISSIONS.filter(
          (p) =>
            ![
              'staff.create',
              'staff.update',
              'staff.delete',
              'settings.update',
            ].includes(p),
        ),
      },
      {
        id: IDS.roleT1Sales,
        tenantId: IDS.tenant1,
        code: 'sales_staff',
        name: 'Nhân viên bán hàng',
        desc: 'Bán hàng tại quầy, tạo và cập nhật đơn hàng, chăm sóc khách.',
        perms: [
          'dashboard.view',
          'products.view',
          'inventory.view',
          'orders.view',
          'orders.create',
          'orders.update',
          'pos.view',
          'pos.create',
          'pos.update',
          'customers.view',
          'customers.create',
          'customers.update',
          'finance.view',
          'finance.create',
        ],
      },
      {
        id: IDS.roleT1Warehouse,
        tenantId: IDS.tenant1,
        code: 'warehouse_staff',
        name: 'Nhân viên kho',
        desc: 'Quản lý tồn kho, nhập hàng và xem đơn hàng cần xử lý.',
        perms: [
          'dashboard.view',
          'products.view',
          'inventory.view',
          'inventory.create',
          'inventory.update',
          'orders.view',
          'purchasing.view',
          'purchasing.create',
        ],
      },
      {
        id: IDS.roleT1Accountant,
        tenantId: IDS.tenant1,
        code: 'accountant',
        name: 'Kế toán',
        desc: 'Xem đơn hàng, công nợ mua hàng và báo cáo.',
        perms: [
          'dashboard.view',
          'orders.view',
          'customers.view',
          'inventory.view',
          'purchasing.view',
          'purchasing.update',
          'reports.view',
          'finance.view',
          'finance.create',
          'finance.update',
          'finance.approve',
        ],
      },
      {
        id: IDS.roleT2Owner,
        tenantId: IDS.tenant2,
        code: 'owner',
        name: 'Chủ cửa hàng',
        desc: 'Toàn quyền với cửa hàng, không thể chỉnh sửa.',
        perms: [],
      },
    ];

    for (const r of roleConfigs) {
      await client.query(
        `INSERT INTO public.role (id, tenant_id, code, name, description, is_seeded)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           updated_at = now()`,
        [r.id, r.tenantId, r.code, r.name, r.desc],
      );
      await client.query(
        `DELETE FROM public.role_permission WHERE role_id = $1`,
        [r.id],
      );
      if (r.perms.length > 0) {
        await client.query(
          `INSERT INTO public.role_permission (role_id, permission_code)
           SELECT $1::uuid, unnest($2::varchar[])
           ON CONFLICT DO NOTHING`,
          [r.id, r.perms],
        );
      }
    }

    // 8. Accounts, Account-Tenant, Account-Tenant-Branch
    const accounts = [
      {
        id: IDS.accT1Owner,
        email: 'chu.cuahang@vietfashion.vn',
        name: 'Nguyễn Minh Quân',
        phone: '0901234567',
        code: 'NV0001',
        tenantId: IDS.tenant1,
        roleCode: 'owner',
        roleId: IDS.roleT1Owner,
        branches: [IDS.branchQ1, IDS.branchQ3, IDS.branchKhoTb],
      },
      {
        id: IDS.accT1Manager,
        email: 'quanly.q1@vietfashion.vn',
        name: 'Lê Thị Thanh Hương',
        phone: '0902345678',
        code: 'NV0002',
        tenantId: IDS.tenant1,
        roleCode: 'branch_manager',
        roleId: IDS.roleT1Manager,
        branches: [IDS.branchQ1, IDS.branchKhoTb],
      },
      {
        id: IDS.accT1Cashier,
        email: 'thungan.q1@vietfashion.vn',
        name: 'Phạm Quốc Bảo',
        phone: '0903456789',
        code: 'NV0003',
        tenantId: IDS.tenant1,
        roleCode: 'sales_staff',
        roleId: IDS.roleT1Sales,
        branches: [IDS.branchQ1],
      },
      {
        id: IDS.accT1Warehouse,
        email: 'thukho.tb@vietfashion.vn',
        name: 'Võ Hoàng Nam',
        phone: '0904567890',
        code: 'NV0004',
        tenantId: IDS.tenant1,
        roleCode: 'warehouse_staff',
        roleId: IDS.roleT1Warehouse,
        branches: [IDS.branchKhoTb, IDS.branchQ1],
      },
      {
        id: IDS.accT1Accountant,
        email: 'ketoan@vietfashion.vn',
        name: 'Đặng Ngọc Mai',
        phone: '0905678901',
        code: 'NV0005',
        tenantId: IDS.tenant1,
        roleCode: 'accountant',
        roleId: IDS.roleT1Accountant,
        branches: [IDS.branchQ1, IDS.branchQ3, IDS.branchKhoTb],
      },
      {
        id: IDS.accT2Owner,
        email: 'chu.cuahang@bachhoasaigon.vn',
        name: 'Huỳnh Gia Hòa',
        phone: '0906789012',
        code: 'NV0006',
        tenantId: IDS.tenant2,
        roleCode: 'owner',
        roleId: IDS.roleT2Owner,
        branches: [IDS.branchT2Bt, IDS.branchT2KhoTd],
      },
    ];

    for (const a of accounts) {
      await client.query(
        `INSERT INTO public.account (
          id, email, password, name, phone, status, code, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,'active',$6,'system','system')
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          password = EXCLUDED.password,
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          status = 'active',
          updated_at = now()`,
        [a.id, a.email, passwordHash, a.name, a.phone, a.code],
      );

      await client.query(
        `INSERT INTO public.account_tenant (
          account_id, tenant_id, role, status, code, role_id
        ) VALUES ($1,$2,$3,'active',$4,$5)
        ON CONFLICT (account_id, tenant_id) DO UPDATE SET
          role = EXCLUDED.role,
          role_id = EXCLUDED.role_id,
          status = 'active'`,
        [a.id, a.tenantId, a.roleCode, a.code, a.roleId],
      );

      for (const bId of a.branches) {
        await client.query(
          `INSERT INTO public.account_tenant_branch (account_id, tenant_id, branch_id)
           VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [a.id, a.tenantId, bId],
        );
      }
    }

    // 9. Staff Schedules (Weekdays 1..7)
    for (let weekday = 1; weekday <= 7; weekday++) {
      await client.query(
        `INSERT INTO public.staff_schedule (
          id, tenant_id, account_id, branch_id, weekday, start_time, end_time,
          name, duty, note, created_by, updated_by
        ) VALUES
          ($1,$2,$3,$4,$5,'08:00:00','15:30:00','Ca Sáng Cửa Hàng Q1','cashier','Phụ trách quầy thu ngân Q01','system','system'),
          ($6,$2,$7,$4,$5,'08:00:00','17:30:00','Ca Hành Chính Quản Lý Q1','shift_lead','Giám sát vận hành & duyệt ca','system','system'),
          ($8,$2,$9,$10,$5,'08:00:00','17:00:00','Ca Kho Tổng Tân Bình','warehouse','Soạn hàng điều chuyển & nhập PO','system','system')
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`sched:cashier:${weekday}`),
          IDS.tenant1,
          IDS.accT1Cashier,
          IDS.branchQ1,
          weekday,
          detUuid(`sched:manager:${weekday}`),
          IDS.accT1Manager,
          detUuid(`sched:warehouse:${weekday}`),
          IDS.accT1Warehouse,
          IDS.branchKhoTb,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function seedCatalog(client: Client): Promise<void> {
  // Seed Tenant 1 Catalog
  await withTenant(client, IDS.tenant1, async (c) => {
    // Clean up any orphan products without variants in tenant 1
    await c.query(
      `DELETE FROM catalog.products p
       WHERE p.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM catalog.product_variants v
           WHERE v.tenant_id = p.tenant_id AND v.product_id = p.id
         )`,
      [IDS.tenant1],
    );

    // 1. Tenant Plan Quota
    await c.query(
      `INSERT INTO catalog.tenant_plan_quota (
        tenant_id, plan_code, quota_products, quota_storage_mb, source_changed_at
      ) VALUES ($1,'pro',20000,51200,now())
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_code = EXCLUDED.plan_code,
        quota_products = EXCLUDED.quota_products,
        quota_storage_mb = EXCLUDED.quota_storage_mb,
        source_changed_at = now()`,
      [IDS.tenant1],
    );

    // 2. Branch Projection
    const branches = [
      {
        id: IDS.branchQ1,
        code: 'CN-Q1',
        name: 'Chi nhánh Quận 1 - Nguyễn Trãi',
        isWh: true,
      },
      {
        id: IDS.branchQ3,
        code: 'CN-Q3',
        name: 'Chi nhánh Quận 3 - Lê Văn Sỹ',
        isWh: true,
      },
      {
        id: IDS.branchKhoTb,
        code: 'KHO-TB',
        name: 'Kho Tổng Tân Bình',
        isWh: true,
      },
    ];
    for (const b of branches) {
      await c.query(
        `INSERT INTO catalog.branch_projection (
          branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,'active',now(),now())
        ON CONFLICT (branch_id) DO UPDATE SET
          name = EXCLUDED.name,
          status = 'active',
          synced_at = now()`,
        [b.id, IDS.tenant1, b.code, b.name, b.isWh],
      );
    }

    // 3. Categories (2-level hierarchy)
    const categories = [
      {
        id: IDS.catNam,
        parentId: null,
        name: 'Thời Trang Nam',
        slug: 'thoi-trang-nam',
        depth: 1,
      },
      {
        id: IDS.catAoThunNam,
        parentId: IDS.catNam,
        name: 'Áo Thun & Polo Nam',
        slug: 'ao-thun-polo-nam',
        depth: 2,
      },
      {
        id: IDS.catAoSoMiNam,
        parentId: IDS.catNam,
        name: 'Áo Sơ Mi Nam',
        slug: 'ao-so-mi-nam',
        depth: 2,
      },
      {
        id: IDS.catQuanNam,
        parentId: IDS.catNam,
        name: 'Quần Jeans & Kaki Nam',
        slug: 'quan-jeans-kaki-nam',
        depth: 2,
      },
      {
        id: IDS.catNu,
        parentId: null,
        name: 'Thời Trang Nữ',
        slug: 'thoi-trang-nu',
        depth: 1,
      },
      {
        id: IDS.catAoNu,
        parentId: IDS.catNu,
        name: 'Áo Thun & Sơ Mi Nữ',
        slug: 'ao-thun-so-mi-nu',
        depth: 2,
      },
      {
        id: IDS.catDamNu,
        parentId: IDS.catNu,
        name: 'Đầm & Chân Váy Công Sở',
        slug: 'dam-chan-vay-cong-so',
        depth: 2,
      },
      {
        id: IDS.catPhuKien,
        parentId: null,
        name: 'Phụ Kiện Thời Trang',
        slug: 'phu-kien-thoi-trang',
        depth: 1,
      },
    ];
    for (const cat of categories) {
      await c.query(
        `INSERT INTO catalog.categories (
          id, tenant_id, parent_id, name, normalized_name, slug, depth, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          normalized_name = EXCLUDED.normalized_name,
          slug = EXCLUDED.slug,
          updated_at = now()`,
        [
          cat.id,
          IDS.tenant1,
          cat.parentId,
          cat.name,
          normalizeVn(cat.name),
          cat.slug,
          cat.depth,
        ],
      );
    }

    // 4. Brands
    const brands = [
      {
        id: IDS.brandCoolmate,
        name: 'Coolmate',
        desc: 'Thương hiệu thời trang nam ứng dụng công nghệ chất liệu Việt Nam',
      },
      {
        id: IDS.brandRoutine,
        name: 'Routine',
        desc: 'Thương hiệu thời trang thiết kế trẻ trung, hiện đại',
      },
      {
        id: IDS.brandYody,
        name: 'Yody',
        desc: 'Thương hiệu thời trang gia đình chất liệu bền vững',
      },
      {
        id: IDS.brandVietTien,
        name: 'Việt Tiến',
        desc: 'Thương hiệu thời trang công sở hàng đầu Việt Nam',
      },
      {
        id: IDS.brandOwen,
        name: 'Owen',
        desc: 'Thời trang lịch lãm dành cho quý ông công sở',
      },
    ];
    for (const br of brands) {
      await c.query(
        `INSERT INTO catalog.brands (
          id, tenant_id, name, normalized_name, description, status
        ) VALUES ($1,$2,$3,$4,$5,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          updated_at = now()`,
        [br.id, IDS.tenant1, br.name, normalizeVn(br.name), br.desc],
      );
    }

    // 5. Attributes & Values
    const attrs = [
      { id: IDS.attrSize, name: 'Kích thước' },
      { id: IDS.attrColor, name: 'Màu sắc' },
    ];
    for (const at of attrs) {
      await c.query(
        `INSERT INTO catalog.attributes (id, tenant_id, name, normalized_name)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO NOTHING`,
        [at.id, IDS.tenant1, at.name, normalizeVn(at.name)],
      );
    }

    const attrValues = [
      { id: IDS.valSizeS, attrId: IDS.attrSize, val: 'Size S' },
      { id: IDS.valSizeM, attrId: IDS.attrSize, val: 'Size M' },
      { id: IDS.valSizeL, attrId: IDS.attrSize, val: 'Size L' },
      { id: IDS.valSizeXL, attrId: IDS.attrSize, val: 'Size XL' },
      { id: IDS.valSizeFree, attrId: IDS.attrSize, val: 'Freesize' },
      { id: IDS.valColorBlack, attrId: IDS.attrColor, val: 'Đen' },
      { id: IDS.valColorWhite, attrId: IDS.attrColor, val: 'Trắng' },
      { id: IDS.valColorNavy, attrId: IDS.attrColor, val: 'Xanh Navy' },
      { id: IDS.valColorBeige, attrId: IDS.attrColor, val: 'Be' },
    ];
    for (const av of attrValues) {
      await c.query(
        `INSERT INTO catalog.attribute_values (id, tenant_id, attribute_id, value, normalized_value)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [av.id, IDS.tenant1, av.attrId, av.val, normalizeVn(av.val)],
      );
    }

    // 6. Products, Product Attributes, Unit Conversions, Variants & Variant Attribute Values
    for (const p of CATALOG_PRODUCTS) {
      const productImages = JSON.stringify([
        {
          key: `seed/${p.code.toLowerCase()}.jpg`,
          url: p.imageUrl,
          sortOrder: 0,
        },
      ]);
      await c.query(
        `INSERT INTO catalog.products (
          id, tenant_id, category_id, brand_id, name, normalized_name, description,
          base_unit, is_combo, status, images, version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'ACTIVE',$9::jsonb,1)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          base_unit = EXCLUDED.base_unit,
          images = EXCLUDED.images,
          updated_at = now()`,
        [
          p.productId,
          IDS.tenant1,
          p.categoryId,
          p.brandId,
          p.name,
          normalizeVn(p.name),
          p.description,
          p.baseUnit,
          productImages,
        ],
      );

      // Link both attributes to product
      await c.query(
        `INSERT INTO catalog.product_attributes (id, tenant_id, product_id, attribute_id, position)
         VALUES ($1,$2,$3,$4,0), ($5,$2,$3,$6,1)
         ON CONFLICT DO NOTHING`,
        [
          detUuid(`prod_attr:${p.productId}:color`),
          IDS.tenant1,
          p.productId,
          IDS.attrColor,
          detUuid(`prod_attr:${p.productId}:size`),
          IDS.attrSize,
        ],
      );

      // Base unit conversion
      await c.query(
        `INSERT INTO catalog.unit_conversions (
          id, tenant_id, product_id, unit_name, normalized_unit_name, conversion_factor, is_base
        ) VALUES ($1,$2,$3,$4,$5,1,true)
        ON CONFLICT DO NOTHING`,
        [
          detUuid(`unit_conv:${p.productId}:base`),
          IDS.tenant1,
          p.productId,
          p.baseUnit,
          normalizeVn(p.baseUnit),
        ],
      );

      for (const v of p.variants) {
        await c.query(
          `INSERT INTO catalog.product_variants (
            id, tenant_id, product_id, sku_code, barcode, name, base_price,
            image_url, weight, combination_signature, is_default, status, version
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ACTIVE',1)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            base_price = EXCLUDED.base_price,
            barcode = EXCLUDED.barcode,
            image_url = EXCLUDED.image_url,
            updated_at = now()`,
          [
            v.variantId,
            IDS.tenant1,
            p.productId,
            v.skuCode,
            v.barcode,
            v.variantName,
            v.basePrice,
            v.imageUrl,
            v.weightGrams,
            v.combinationSignature,
            v.isDefault,
          ],
        );

        await c.query(
          `INSERT INTO catalog.variant_attribute_values (
            id, tenant_id, variant_id, attribute_id, attribute_value_id
          ) VALUES
            ($1,$2,$3,$4,$5),
            ($6,$2,$3,$7,$8)
          ON CONFLICT DO NOTHING`,
          [
            detUuid(`vav:${v.variantId}:color`),
            IDS.tenant1,
            v.variantId,
            IDS.attrColor,
            v.colorValueId,
            detUuid(`vav:${v.variantId}:size`),
            IDS.attrSize,
            v.sizeValueId,
          ],
        );
      }
    }

    // 7. Price Lists & Items
    const priceLists = [
      {
        id: IDS.plDefault,
        name: 'Bảng giá bán lẻ niêm yết 2026',
        isDefault: true,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
      {
        id: IDS.plVip,
        name: 'Bảng giá Ưu đãi Khách VIP (-10%)',
        isDefault: false,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
      {
        id: IDS.plBranchQ1,
        name: 'Bảng giá Khuyến mãi Chi nhánh Quận 1',
        isDefault: false,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
    ];

    for (const pl of priceLists) {
      await c.query(
        `INSERT INTO catalog.price_lists (
          id, tenant_id, name, normalized_name, currency, start_date, end_date, is_default, status, version
        ) VALUES ($1,$2,$3,$4,'VND',$5,$6,$7,'ACTIVE',1)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          updated_at = now()`,
        [
          pl.id,
          IDS.tenant1,
          pl.name,
          normalizeVn(pl.name),
          pl.startDate,
          pl.endDate,
          pl.isDefault,
        ],
      );
    }

    for (const v of ALL_VARIANTS) {
      const items = [
        { plId: IDS.plDefault, price: v.basePrice },
        { plId: IDS.plVip, price: v.vipPrice },
        { plId: IDS.plBranchQ1, price: v.q1Price },
      ];
      for (const it of items) {
        await c.query(
          `INSERT INTO catalog.price_list_items (
            id, tenant_id, price_list_id, variant_id, price, version
          ) VALUES ($1,$2,$3,$4,$5,1)
          ON CONFLICT (id) DO UPDATE SET
            price = EXCLUDED.price,
            updated_at = now()`,
          [
            detUuid(`pli:${it.plId}:${v.variantId}`),
            IDS.tenant1,
            it.plId,
            v.variantId,
            it.price,
          ],
        );
      }
    }

    // Link Price Lists to Branches, Customer Groups, Channels
    await c.query(
      `INSERT INTO catalog.price_list_branches (id, tenant_id, price_list_id, branch_id, is_active)
       VALUES
         ($1,$2,$3,$4,true),
         ($5,$2,$6,$4,true),
         ($7,$2,$3,$8,true)
       ON CONFLICT DO NOTHING`,
      [
        detUuid('plb:default:q1'),
        IDS.tenant1,
        IDS.plDefault,
        IDS.branchQ1,
        detUuid('plb:q1:q1'),
        IDS.plBranchQ1,
        detUuid('plb:default:q3'),
        IDS.branchQ3,
      ],
    );

    await c.query(
      `INSERT INTO catalog.price_list_customer_groups (id, tenant_id, price_list_id, customer_group_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [detUuid('plcg:vip'), IDS.tenant1, IDS.plVip, IDS.cgVip],
    );

    await c.query(
      `INSERT INTO catalog.price_list_channels (id, tenant_id, price_list_id, channel_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING`,
      [detUuid('plc:q1:pos'), IDS.tenant1, IDS.plBranchQ1, IDS.chPos],
    );
  });

  // Also seed Tenant 2 quota & branches in Catalog
  await withTenant(client, IDS.tenant2, async (c) => {
    await c.query(
      `INSERT INTO catalog.tenant_plan_quota (
        tenant_id, plan_code, quota_products, quota_storage_mb, source_changed_at
      ) VALUES ($1,'basic',2000,5120,now())
      ON CONFLICT (tenant_id) DO NOTHING`,
      [IDS.tenant2],
    );
    await c.query(
      `INSERT INTO catalog.branch_projection (
        branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at, synced_at
      ) VALUES
        ($1,$2,'CN-BT','Chi nhánh Bình Thạnh',true,'active',now(),now()),
        ($3,$2,'KHO-TD','Kho Tổng Thủ Đức',true,'active',now(),now())
      ON CONFLICT (branch_id) DO NOTHING`,
      [IDS.branchT2Bt, IDS.tenant2, IDS.branchT2KhoTd],
    );
  });
}

export async function seedCustomer(client: Client): Promise<void> {
  await withTenant(client, IDS.tenant1, async (c) => {
    // 1. Code sequence
    await c.query(
      `INSERT INTO customer.customer_code_sequence (id, tenant_id, seq_key, last_value)
       VALUES ($1,$2,'CUSTOMER',8)
       ON CONFLICT (id) DO UPDATE SET last_value = GREATEST(customer.customer_code_sequence.last_value, 8)`,
      [detUuid('cust_seq:t1'), IDS.tenant1],
    );

    // 2. Customer Groups
    const groups = [
      {
        id: IDS.cgWalkIn,
        code: 'walk_in',
        name: 'Khách lẻ',
        desc: 'Khách mua lẻ vãng lai tại cửa hàng',
        disc: 0,
      },
      {
        id: IDS.cgMember,
        code: 'member',
        name: 'Thành viên',
        desc: 'Khách hàng thành viên có đăng ký tích điểm',
        disc: 2,
      },
      {
        id: IDS.cgVip,
        code: 'vip',
        name: 'VIP',
        desc: 'Khách hàng thân thiết chi tiêu cao',
        disc: 10,
      },
      {
        id: IDS.cgWholesale,
        code: 'wholesale',
        name: 'Khách sỉ',
        desc: 'Đại lý và khách mua sỉ số lượng lớn',
        disc: 15,
      },
    ];
    for (const g of groups) {
      await c.query(
        `INSERT INTO customer.customer_groups (
          id, tenant_id, code, name, description, default_discount_rate, status, is_seeded
        ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',true)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          default_discount_rate = EXCLUDED.default_discount_rate,
          updated_at = now()`,
        [g.id, IDS.tenant1, g.code, g.name, g.desc, g.disc],
      );
    }

    // 3. Membership Tiers
    const tiers = [
      {
        id: IDS.tierBronze,
        code: 'BRONZE',
        name: 'Hạng Đồng',
        minPoints: 0,
        discount: 0,
        benefits: { freeShipping: false, birthdayVoucherVnd: 50000 },
      },
      {
        id: IDS.tierSilver,
        code: 'SILVER',
        name: 'Hạng Bạc',
        minPoints: 300,
        discount: 3,
        benefits: { freeShipping: true, birthdayVoucherVnd: 100000 },
      },
      {
        id: IDS.tierGold,
        code: 'GOLD',
        name: 'Hạng Vàng',
        minPoints: 1000,
        discount: 7,
        benefits: { freeShipping: true, birthdayVoucherVnd: 200000 },
      },
      {
        id: IDS.tierDiamond,
        code: 'DIAMOND',
        name: 'Hạng Kim Cương',
        minPoints: 2500,
        discount: 12,
        benefits: {
          freeShipping: true,
          birthdayVoucherVnd: 500000,
          prioritySupport: true,
        },
      },
    ];
    for (const t of tiers) {
      await c.query(
        `INSERT INTO customer.membership_tiers (
          id, tenant_id, code, name, min_points, discount_rate, benefits_json, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          min_points = EXCLUDED.min_points,
          discount_rate = EXCLUDED.discount_rate,
          updated_at = now()`,
        [
          t.id,
          IDS.tenant1,
          t.code,
          t.name,
          t.minPoints,
          t.discount,
          JSON.stringify(t.benefits),
        ],
      );
    }

    // 4. Loyalty Settings
    await c.query(
      `INSERT INTO customer.loyalty_settings (
        id, tenant_id, is_enabled, earn_amount_per_point, redeem_value_per_point,
        min_redeem_points, max_redeem_points_per_order, hold_ttl_seconds, points_expiration_days, updated_by
      ) VALUES ($1,$2,true,10000,1000,10,5000,900,365,$3)
      ON CONFLICT (id) DO UPDATE SET
        earn_amount_per_point = EXCLUDED.earn_amount_per_point,
        redeem_value_per_point = EXCLUDED.redeem_value_per_point,
        updated_at = now()`,
      [detUuid('loyalty_settings:t1'), IDS.tenant1, IDS.accT1Owner],
    );

    // 5. Customer Tags
    const tags = [
      { id: detUuid('cust_tag:t1:q1'), name: 'Khách quen Quận 1' },
      { id: detUuid('cust_tag:t1:office'), name: 'Yêu thích đồ công sở' },
      { id: detUuid('cust_tag:t1:wholesale'), name: 'Đối tác sỉ miền Nam' },
      { id: detUuid('cust_tag:t1:online'), name: 'Săn sale Sàn TMĐT' },
    ];
    for (const tg of tags) {
      await c.query(
        `INSERT INTO customer.customer_tags (id, tenant_id, name)
         VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [tg.id, IDS.tenant1, tg.name],
      );
    }

    // 6. Customers, Addresses, Loyalty Accounts & Transactions
    for (const cust of CUSTOMERS_SEED) {
      await c.query(
        `INSERT INTO customer.customers (
          id, tenant_id, code, member_code, loyalty_enabled, customer_group_id,
          membership_tier_id, name, phone, phone_normalized, email, gender,
          date_of_birth, source, status, debt_limit, current_debt, note
        ) VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$8,$9,$10,$11,$12,'ACTIVE',$13,$14,$15)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          current_debt = EXCLUDED.current_debt,
          updated_at = now()`,
        [
          cust.id,
          IDS.tenant1,
          cust.code,
          cust.memberCode,
          cust.groupId,
          cust.tierId,
          cust.name,
          cust.phone,
          cust.email,
          cust.gender,
          cust.dob,
          cust.source,
          cust.debtLimit,
          cust.currentDebt,
          'Khách hàng thân thiết hệ thống Thời Trang Việt',
        ],
      );

      await c.query(
        `INSERT INTO customer.customer_addresses (
          id, tenant_id, customer_id, recipient_name, phone, phone_normalized,
          address_line, ward, district, province, is_default, status
        ) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,true,'ACTIVE')
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`cust_addr:${cust.id}`),
          IDS.tenant1,
          cust.id,
          cust.name,
          cust.phone,
          cust.address,
          cust.ward,
          cust.district,
          cust.province,
        ],
      );

      const loyaltyAccId = detUuid(`loyalty_acc:${cust.id}`);
      await c.query(
        `INSERT INTO customer.loyalty_accounts (
          id, tenant_id, customer_id, posted_points_balance, held_points,
          lifetime_earned_points, lifetime_redeemed_points, qualifying_points, tier_id, status
        ) VALUES ($1,$2,$3,$4,0,$5,$6,$5,$7,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET
          posted_points_balance = EXCLUDED.posted_points_balance,
          lifetime_earned_points = EXCLUDED.lifetime_earned_points,
          updated_at = now()`,
        [
          loyaltyAccId,
          IDS.tenant1,
          cust.id,
          cust.points,
          cust.lifetimeEarned,
          cust.lifetimeRedeemed,
          cust.tierId,
        ],
      );

      if (cust.points > 0) {
        await c.query(
          `INSERT INTO customer.loyalty_transactions (
            id, tenant_id, customer_id, loyalty_account_id, transaction_type,
            points_delta, balance_before, balance_after, source_type, source_ref_id,
            idempotency_key, eligible_spend_amount, applied_rate_amount_per_point,
            actor_id, reason
          ) VALUES ($1,$2,$3,$4,'EARN',$5,0,$5,'ORDER',$6,$7,$8,10000,$9,'Tích điểm mua hàng thành viên')
          ON CONFLICT (id) DO NOTHING`,
          [
            detUuid(`loyalty_tx:${cust.id}:init`),
            IDS.tenant1,
            cust.id,
            loyaltyAccId,
            cust.points,
            `INIT-${cust.code}`,
            `idem:loyalty:init:${cust.id}`,
            cust.points * 10000,
            IDS.accT1Cashier,
          ],
        );
      }
    }

    // Tag links
    await c.query(
      `INSERT INTO customer.customer_tag_links (tenant_id, customer_id, tag_id)
       VALUES
         ($1,$2,$3),
         ($1,$4,$5),
         ($1,$6,$7)
       ON CONFLICT DO NOTHING`,
      [
        IDS.tenant1,
        CUSTOMERS_SEED[0].id,
        detUuid('cust_tag:t1:q1'),
        CUSTOMERS_SEED[1].id,
        detUuid('cust_tag:t1:office'),
        CUSTOMERS_SEED[4].id,
        detUuid('cust_tag:t1:wholesale'),
      ],
    );
  });

  // Seed Tenant 2 Default Customer Groups
  await withTenant(client, IDS.tenant2, async (c) => {
    const t2Groups = [
      {
        id: IDS.cgT2WalkIn,
        code: 'walk_in',
        name: 'Khách lẻ',
        desc: 'Khách mua lẻ tại cửa hàng',
      },
      {
        id: IDS.cgT2Member,
        code: 'member',
        name: 'Thành viên',
        desc: 'Khách hàng thành viên tích điểm',
      },
      {
        id: IDS.cgT2Vip,
        code: 'vip',
        name: 'VIP',
        desc: 'Khách hàng thân thiết chi tiêu cao',
      },
      {
        id: IDS.cgT2Wholesale,
        code: 'wholesale',
        name: 'Khách sỉ',
        desc: 'Khách mua sỉ số lượng lớn',
      },
    ];
    for (const g of t2Groups) {
      await c.query(
        `INSERT INTO customer.customer_groups (
          id, tenant_id, code, name, description, default_discount_rate, status, is_seeded
        ) VALUES ($1,$2,$3,$4,$5,0,'ACTIVE',true)
        ON CONFLICT (id) DO NOTHING`,
        [g.id, IDS.tenant2, g.code, g.name, g.desc],
      );
    }
  });
}
