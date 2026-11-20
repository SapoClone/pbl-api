import {
  ALL_VARIANTS,
  CATALOG_PRODUCTS,
  IDS,
  createServiceClient,
  detUuid,
  loadServiceConfigs,
  normalizeVn,
  sha256Fixed,
  vnDateString,
  vnTimestamp,
  withTenant,
} from './helpers';

const PRODUCT_IMAGES: Record<string, string> = {
  SP000001:
    'https://images.unsplash.com/photo-1581655353564-df123a1eb820?auto=format&fit=crop&w=600&q=80',
  SP000002:
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=600&q=80',
  SP000003:
    'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=600&q=80',
  SP000004:
    'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80',
  SP000005:
    'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=600&q=80',
  SP000006:
    'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=600&q=80',
  SP000007:
    'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80',
  SP000008:
    'https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=600&q=80',
};

const EXTRA_LAZADA_PRODUCTS = [
  {
    code: 'SP000009',
    productId: detUuid('product:t1:SP000009'),
    variantId: detUuid('variant:t1:SP000009-L-BE'),
    name: 'Áo Sơ Mi Linen Nam Cổ Tàu Lazada Mall',
    variantName: 'Áo Sơ Mi Linen Nam Cổ Tàu - Be Tự Nhiên / Size L',
    skuCode: 'SOMI-LN-BE-L',
    barcode: '8938505974153',
    description:
      'Áo sơ mi đũi Linen thoáng mát chuẩn phong cách Hàn Quốc, sản phẩm bán chạy Top 1 Lazada Flagship.',
    categoryId: IDS.catAoSoMiNam,
    brandId: IDS.brandRoutine,
    baseUnit: 'Cái',
    unitCost: 195000,
    basePrice: 359000,
    lazadaPrice: 349000,
    qtyQ1: 65,
    imageUrl:
      'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=600&q=80',
    lzdItemId: '13504402015',
    lzdSkuId: '11755389815',
  },
  {
    code: 'SP000010',
    productId: detUuid('product:t1:SP000010'),
    variantId: detUuid('variant:t1:SP000010-L-BE'),
    name: 'Quần Kaki Nam Owen Khaki Chino Co Giãn',
    variantName: 'Quần Kaki Nam Owen Khaki Chino - Kem Be / Size L',
    skuCode: 'KAKI-OW-BE-L',
    barcode: '8938505974160',
    description:
      'Quần Kaki nam công sở phom Regular lịch sự, chất vải Cotton Twill bền màu, dễ phối sơ mi và áo polo.',
    categoryId: IDS.catQuanNam,
    brandId: IDS.brandOwen,
    baseUnit: 'Quần',
    unitCost: 270000,
    basePrice: 495000,
    lazadaPrice: 495000,
    qtyQ1: 50,
    imageUrl:
      'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=600&q=80',
    lzdItemId: '13504402016',
    lzdSkuId: '11755389816',
  },
  {
    code: 'SP000011',
    productId: detUuid('product:t1:SP000011'),
    variantId: detUuid('variant:t1:SP000011-M-DEN'),
    name: 'Áo Khoác Blazer Nữ Công Sở Routine 2 Lớp',
    variantName: 'Áo Khoác Blazer Nữ Công Sở Routine - Đen Tuyền / Size M',
    skuCode: 'BLAZER-RT-DEN-M',
    barcode: '8938505974177',
    description:
      'Áo Blazer nữ dáng suông hiện đại, đệm vai nhẹ tôn dáng, phù hợp đi làm và dự tiệc.',
    categoryId: IDS.catDamNu,
    brandId: IDS.brandRoutine,
    baseUnit: 'Chiếc',
    unitCost: 450000,
    basePrice: 790000,
    lazadaPrice: 820000,
    qtyQ1: 35,
    imageUrl:
      'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=600&q=80',
    lzdItemId: '13504402017',
    lzdSkuId: '11755389817',
  },
  {
    code: 'SP000012',
    productId: detUuid('product:t1:SP000012'),
    variantId: detUuid('variant:t1:SP000012-FREE-TRANG'),
    name: 'Túi Xách Nữ Đeo Chéo Da Mềm Thời Trang Việt',
    variantName: 'Túi Xách Nữ Đeo Chéo Da Mềm - Trắng Kem / Freesize',
    skuCode: 'TUI-TTV-KEM-FS',
    barcode: '8938505974184',
    description:
      'Túi đeo chéo nữ da tổng hợp cao cấp chống xước, khóa mạ vàng sang trọng, kèm dây đeo điều chỉnh.',
    categoryId: IDS.catPhuKien,
    brandId: IDS.brandYody,
    baseUnit: 'Chiếc',
    unitCost: 210000,
    basePrice: 389000,
    lazadaPrice: 379000,
    qtyQ1: 42,
    imageUrl:
      'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=600&q=80',
    lzdItemId: '13504402018',
    lzdSkuId: '11755389818',
  },
];

const LAZADA_CUSTOMERS = [
  {
    code: 'KH000009',
    memberCode: 'LZD-2026-009',
    groupId: IDS.cgVip,
    tierId: IDS.tierGold,
    name: 'Nguyễn Quốc Bảo',
    phone: '0908112299',
    email: 'quocbao.lazada@gmail.com',
    gender: 'MALE',
    dob: '1992-03-18',
    source: 'LAZADA',
    address:
      'Số 190 Nguyễn Thị Định, Phường An Phú, TP. Thủ Đức, TP. Hồ Chí Minh',
    ward: 'Phường An Phú',
    district: 'TP. Thủ Đức',
    province: 'TP. Hồ Chí Minh',
    points: 1120,
    note: 'Khách VIP thường xuyên mua Sơ mi & Polo trên Lazada Flagship Store',
  },
  {
    code: 'KH000010',
    memberCode: 'LZD-2026-010',
    groupId: IDS.cgMember,
    tierId: IDS.tierSilver,
    name: 'Đặng Ngọc Quỳnh Như',
    phone: '0932445511',
    email: 'quynhnhu.dang@gmail.com',
    gender: 'FEMALE',
    dob: '1997-06-22',
    source: 'LAZADA',
    address:
      'Tòa S2.05 Vinhomes Grand Park, Nguyễn Xiển, TP. Thủ Đức, TP. Hồ Chí Minh',
    ward: 'Phường Long Thạnh Mỹ',
    district: 'TP. Thủ Đức',
    province: 'TP. Hồ Chí Minh',
    points: 680,
    note: 'Khách hàng đồng bộ từ sàn Lazada (Ưu tiên giao LEX VN buổi sáng)',
  },
  {
    code: 'KH000011',
    memberCode: 'LZD-2026-011',
    groupId: IDS.cgMember,
    tierId: IDS.tierSilver,
    name: 'Lâm Gia Huy',
    phone: '0914668822',
    email: 'giahuy.lam95@gmail.com',
    gender: 'MALE',
    dob: '1995-11-05',
    source: 'LAZADA',
    address: 'Số 45 Phan Châu Trinh, Quận Hải Châu, TP. Đà Nẵng',
    ward: 'Phường Hải Châu 1',
    district: 'Quận Hải Châu',
    province: 'TP. Đà Nẵng',
    points: 540,
    note: 'Khách mua hàng Lazada Mall - Thanh toán ví ZaloPay trên Lazada',
  },
  {
    code: 'KH000012',
    memberCode: 'LZD-2026-012',
    groupId: IDS.cgVip,
    tierId: IDS.tierGold,
    name: 'Trương Mỹ Linh',
    phone: '0983771144',
    email: 'mylinh.truong@techcombank.com.vn',
    gender: 'FEMALE',
    dob: '1991-09-12',
    source: 'LAZADA',
    address: 'Số 108 Láng Hạ, Quận Đống Đa, TP. Hà Nội',
    ward: 'Phường Láng Hạ',
    district: 'Quận Đống Đa',
    province: 'TP. Hà Nội',
    points: 1350,
    note: 'Khách VIP Lazada săn sale thương hiệu Routine & Yody',
  },
  {
    code: 'KH000013',
    memberCode: 'LZD-2026-013',
    groupId: IDS.cgMember,
    tierId: IDS.tierBronze,
    name: 'Phan Minh Tuấn',
    phone: '0971990033',
    email: 'minhtuan.phan@gmail.com',
    gender: 'MALE',
    dob: '1999-01-29',
    source: 'LAZADA',
    address: 'Số 62 Quang Trung, Quận Gò Vấp, TP. Hồ Chí Minh',
    ward: 'Phường 10',
    district: 'Quận Gò Vấp',
    province: 'TP. Hồ Chí Minh',
    points: 230,
    note: 'Khách hàng mới từ chiến dịch Lazada Super Brand Day',
  },
  {
    code: 'KH000014',
    memberCode: 'LZD-2026-014',
    groupId: IDS.cgMember,
    tierId: IDS.tierSilver,
    name: 'Đoàn Thị Phương Thảo',
    phone: '0906228877',
    email: 'phuongthao.doan@gmail.com',
    gender: 'FEMALE',
    dob: '1996-04-09',
    source: 'LAZADA',
    address: 'Số 210 Nguyễn Văn Linh, Quận 7, TP. Hồ Chí Minh',
    ward: 'Phường Tân Thuận Tây',
    district: 'Quận 7',
    province: 'TP. Hồ Chí Minh',
    points: 490,
    note: 'Khách mua Đầm công sở & Túi xách trên Lazada Flagship',
  },
  {
    code: 'KH000015',
    memberCode: 'LZD-2026-015',
    groupId: IDS.cgMember,
    tierId: IDS.tierBronze,
    name: 'Ngô Đức Anh',
    phone: '0939551188',
    email: 'ducanh.ngo@gmail.com',
    gender: 'MALE',
    dob: '1994-08-17',
    source: 'LAZADA',
    address: 'Số 15 Lê Lợi, TP. Huế, Thừa Thiên Huế',
    ward: 'Phường Vĩnh Ninh',
    district: 'TP. Huế',
    province: 'Thừa Thiên Huế',
    points: 195,
    note: 'Khách hàng đồng bộ tự động từ đơn hàng Lazada COD',
  },
  {
    code: 'KH000016',
    memberCode: 'LZD-2026-016',
    groupId: IDS.cgVip,
    tierId: IDS.tierDiamond,
    name: 'Mai Thanh Trúc',
    phone: '0919883366',
    email: 'thanhtruc.mai@gmail.com',
    gender: 'FEMALE',
    dob: '1990-12-24',
    source: 'LAZADA',
    address: 'Khu đô thị Sala Đại Quang Minh, Quận 2, TP. Hồ Chí Minh',
    ward: 'Phường An Lợi Đông',
    district: 'TP. Thủ Đức',
    province: 'TP. Hồ Chí Minh',
    points: 2680,
    note: 'Khách Hạng Kim Cương mua sắm đa kênh (POS Quận 1 & Lazada Mall)',
  },
  {
    code: 'KH000017',
    memberCode: 'LZD-2026-017',
    groupId: IDS.cgMember,
    tierId: IDS.tierBronze,
    name: 'Trịnh Quốc Khánh',
    phone: '0962334499',
    email: 'quockhanh.trinh@gmail.com',
    gender: 'MALE',
    dob: '1998-07-30',
    source: 'LAZADA',
    address: 'Số 88 đường 30/4, Quận Ninh Kiều, TP. Cần Thơ',
    ward: 'Phường An Phú',
    district: 'Quận Ninh Kiều',
    province: 'TP. Cần Thơ',
    points: 160,
    note: 'Khách hàng Lazada khu vực Tây Nam Bộ',
  },
  {
    code: 'KH000018',
    memberCode: 'LZD-2026-018',
    groupId: IDS.cgMember,
    tierId: IDS.tierSilver,
    name: 'Lương Bích Ngọc',
    phone: '0948119922',
    email: 'bichngoc.luong@gmail.com',
    gender: 'FEMALE',
    dob: '1995-02-11',
    source: 'LAZADA',
    address: 'Số 33 Trần Phú, TP. Nha Trang, Khánh Hòa',
    ward: 'Phường Lộc Thọ',
    district: 'TP. Nha Trang',
    province: 'Khánh Hòa',
    points: 390,
    note: 'Khách hàng thân thiết gian hàng Lazada Thời Trang Việt',
  },
];

async function run() {
  const { configs } = loadServiceConfigs(process.cwd());

  // 1. Seed Product Images & Extra Lazada Products into Catalog
  const catClient = await createServiceClient(configs.catalog);
  await withTenant(catClient, IDS.tenant1, async (c) => {
    for (const p of CATALOG_PRODUCTS) {
      const imgUrl = PRODUCT_IMAGES[p.code];
      const imagesJson = JSON.stringify([
        {
          key: `seed/${p.code}.jpg`,
          url: imgUrl,
          altText: p.name,
          sortOrder: 0,
        },
      ]);
      await c.query(
        `UPDATE catalog.products SET images = $1::jsonb, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
        [imagesJson, p.productId, IDS.tenant1],
      );
      for (const v of p.variants) {
        await c.query(
          `UPDATE catalog.product_variants SET image_url = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
          [imgUrl, v.variantId, IDS.tenant1],
        );
      }
    }

    // Also update any custom product without images (e.g. "Áo quần Nam 2026")
    await c.query(
      `UPDATE catalog.products
       SET images = '[{"key":"seed/custom-men.jpg","url":"https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=600&q=80","altText":"Thời trang nam Lazada","sortOrder":0}]'::jsonb
       WHERE tenant_id = $1 AND (images IS NULL OR images = '[]'::jsonb)`,
      [IDS.tenant1],
    );

    for (const ep of EXTRA_LAZADA_PRODUCTS) {
      const imagesJson = JSON.stringify([
        {
          key: `seed/${ep.code}.jpg`,
          url: ep.imageUrl,
          altText: ep.name,
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
          images = EXCLUDED.images,
          updated_at = now()`,
        [
          ep.productId,
          IDS.tenant1,
          ep.categoryId,
          ep.brandId,
          ep.name,
          normalizeVn(ep.name),
          ep.description,
          ep.baseUnit,
          imagesJson,
        ],
      );

      await c.query(
        `INSERT INTO catalog.product_variants (
          id, tenant_id, product_id, sku_code, barcode, name, base_price,
          weight, combination_signature, is_default, image_url, status, version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,300,$8,true,$9,'ACTIVE',1)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          base_price = EXCLUDED.base_price,
          image_url = EXCLUDED.image_url,
          updated_at = now()`,
        [
          ep.variantId,
          IDS.tenant1,
          ep.productId,
          ep.skuCode,
          ep.barcode,
          ep.variantName,
          ep.basePrice,
          `lzd:${ep.skuCode}`,
          ep.imageUrl,
        ],
      );
    }
  });
  await catClient.end();
  console.log('1/5 Catalog products & images updated.');

  // 2. Seed Inventory Stocks for Extra Lazada Products
  const invClient = await createServiceClient(configs.inventory);
  await withTenant(invClient, IDS.tenant1, async (c) => {
    for (const ep of EXTRA_LAZADA_PRODUCTS) {
      await c.query(
        `INSERT INTO inventory.catalog_sku_projection (
          id, tenant_id, sku_id, product_id, sku_code, name, base_unit, barcode,
          base_price, status, aggregate_version, source_updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',1,now(),now())
        ON CONFLICT (id) DO UPDATE SET base_price = EXCLUDED.base_price, synced_at = now()`,
        [
          detUuid(`inv_sku_proj:${ep.variantId}`),
          IDS.tenant1,
          ep.variantId,
          ep.productId,
          ep.skuCode,
          ep.variantName,
          ep.baseUnit,
          ep.barcode,
          ep.basePrice,
        ],
      );

      const valuation = ep.qtyQ1 * ep.unitCost;
      await c.query(
        `INSERT INTO inventory.stock_threshold (
          id, tenant_id, warehouse_id, sku_id, min_qty, max_qty
        ) VALUES ($1,$2,$3,$4,10,120)
        ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
        [
          detUuid(`thresh:${IDS.whQ1Main}:${ep.variantId}`),
          IDS.tenant1,
          IDS.whQ1Main,
          ep.variantId,
        ],
      );

      await c.query(
        `INSERT INTO inventory.stock_balance (
          id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty,
          in_transit_qty, version, avg_unit_cost, valuation_amount
        ) VALUES ($1,$2,$3,$4,$5,0,0,1,$6,$7)
        ON CONFLICT (id) DO UPDATE SET
          on_hand_qty = EXCLUDED.on_hand_qty,
          avg_unit_cost = EXCLUDED.avg_unit_cost,
          valuation_amount = EXCLUDED.valuation_amount,
          updated_at = now()`,
        [
          detUuid(`sbal:${IDS.whQ1Main}:${ep.variantId}`),
          IDS.tenant1,
          IDS.whQ1Main,
          ep.variantId,
          ep.qtyQ1,
          ep.unitCost,
          valuation,
        ],
      );
    }
  });
  await invClient.end();
  console.log('2/5 Inventory balances updated.');

  // 3. Seed 10 Lazada Customers into Customer schema
  const custClient = await createServiceClient(configs.customer);
  await withTenant(custClient, IDS.tenant1, async (c) => {
    for (const lc of LAZADA_CUSTOMERS) {
      const custId = detUuid(`customer:t1:${lc.code}`);
      await c.query(
        `INSERT INTO customer.customers (
          id, tenant_id, code, member_code, loyalty_enabled, customer_group_id,
          membership_tier_id, name, phone, phone_normalized, email, gender,
          date_of_birth, source, status, debt_limit, current_debt, note
        ) VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$8,$9,$10,$11,$12,'ACTIVE',5000000,0,$13)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          source = EXCLUDED.source,
          note = EXCLUDED.note,
          updated_at = now()`,
        [
          custId,
          IDS.tenant1,
          lc.code,
          lc.memberCode,
          lc.groupId,
          lc.tierId,
          lc.name,
          lc.phone,
          lc.email,
          lc.gender,
          lc.dob,
          lc.source,
          lc.note,
        ],
      );

      await c.query(
        `INSERT INTO customer.customer_addresses (
          id, tenant_id, customer_id, recipient_name, phone, phone_normalized,
          address_line, ward, district, province, is_default, status
        ) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,true,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET
          address_line = EXCLUDED.address_line,
          district = EXCLUDED.district,
          province = EXCLUDED.province`,
        [
          detUuid(`cust_addr:${custId}`),
          IDS.tenant1,
          custId,
          lc.name,
          lc.phone,
          lc.address,
          lc.ward,
          lc.district,
          lc.province,
        ],
      );

      await c.query(
        `INSERT INTO customer.loyalty_accounts (
          id, tenant_id, customer_id, posted_points_balance, held_points,
          lifetime_earned_points, lifetime_redeemed_points, qualifying_points, tier_id, status
        ) VALUES ($1,$2,$3,$4,0,$4,0,$4,$5,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET posted_points_balance = EXCLUDED.posted_points_balance`,
        [
          detUuid(`loyalty_acc:${custId}`),
          IDS.tenant1,
          custId,
          lc.points,
          lc.tierId,
        ],
      );
    }
  });
  console.log('3/5 Lazada customers seeded (11 Lazada customers total).');

  // 4. Seed 9 more Lazada Orders (DH000010 .. DH000018) into Sales schema
  const salesOrdersLazada = [
    {
      code: 'DH000010',
      extCode: 'LZD-8899202612',
      dayOffset: 0,
      hourVn: 1,
      cust: LAZADA_CUSTOMERS[0],
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'RESERVED',
      fulfillmentStage: 'SHIPPING',
      paymentMethod: 'MARKETPLACE',
      shippingFee: 22000,
      carrier: 'lex_vn',
      tracking: 'LEXVN0988776612',
      note: 'Đơn Lazada Mall - Đã bàn giao cho Lazada Express (LEX VN)',
      items: [
        {
          sku: 'POLO-CM-DEN-M',
          name: 'Áo Polo Nam Coolmate Excool Khử Mùi - Đen / Size M',
          price: 299000,
          cost: 165000,
          qty: 2,
          variantId: ALL_VARIANTS[0].variantId,
          productId: ALL_VARIANTS[0].productId,
        },
        {
          sku: 'SOMI-LN-BE-L',
          name: 'Áo Sơ Mi Linen Nam Cổ Tàu - Be Tự Nhiên / Size L',
          price: 349000,
          cost: 195000,
          qty: 1,
          variantId: EXTRA_LAZADA_PRODUCTS[0].variantId,
          productId: EXTRA_LAZADA_PRODUCTS[0].productId,
        },
      ],
    },
    {
      code: 'DH000011',
      extCode: 'LZD-8899202613',
      dayOffset: 0,
      hourVn: 2,
      cust: LAZADA_CUSTOMERS[1],
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      paymentMethod: 'MARKETPLACE',
      shippingFee: 18000,
      carrier: 'lex_vn',
      tracking: 'LEXVN0988776613',
      note: 'Đơn Lazada Flagship - Giao thành công và đã đối soát ví Lazada',
      items: [
        {
          sku: 'BLAZER-RT-DEN-M',
          name: 'Áo Khoác Blazer Nữ Công Sở Routine - Đen Tuyền / Size M',
          price: 820000,
          cost: 450000,
          qty: 1,
          variantId: EXTRA_LAZADA_PRODUCTS[2].variantId,
          productId: EXTRA_LAZADA_PRODUCTS[2].productId,
        },
        {
          sku: 'TUI-TTV-KEM-FS',
          name: 'Túi Xách Nữ Đeo Chéo Da Mềm - Trắng Kem / Freesize',
          price: 379000,
          cost: 210000,
          qty: 1,
          variantId: EXTRA_LAZADA_PRODUCTS[3].variantId,
          productId: EXTRA_LAZADA_PRODUCTS[3].productId,
        },
      ],
    },
    {
      code: 'DH000012',
      extCode: 'LZD-8899202614',
      dayOffset: 0,
      hourVn: 3,
      cust: LAZADA_CUSTOMERS[2],
      orderStatus: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'RESERVED',
      fulfillmentStage: 'PACKING',
      paymentMethod: 'COD',
      shippingFee: 25000,
      carrier: 'ghn',
      tracking: 'GHNLZD20260014',
      note: 'Đơn Lazada COD - Đang đóng gói tại Kho Chi nhánh Quận 1',
      items: [
        {
          sku: 'KAKI-OW-BE-L',
          name: 'Quần Kaki Nam Owen Khaki Chino - Kem Be / Size L',
          price: 495000,
          cost: 270000,
          qty: 1,
          variantId: EXTRA_LAZADA_PRODUCTS[1].variantId,
          productId: EXTRA_LAZADA_PRODUCTS[1].productId,
        },
        {
          sku: 'TLUNG-OW-DEN-FS',
          name: 'Thắt Lưng Da Bò Nam Khóa Tự Động Owen - Đen / Freesize',
          price: 350000,
          cost: 190000,
          qty: 1,
          variantId: ALL_VARIANTS[13].variantId,
          productId: ALL_VARIANTS[13].productId,
        },
      ],
    },
    {
      code: 'DH000013',
      extCode: 'LZD-8899202615',
      dayOffset: -1,
      hourVn: 10,
      cust: LAZADA_CUSTOMERS[3],
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      paymentMethod: 'MARKETPLACE',
      shippingFee: 20000,
      carrier: 'lex_vn',
      tracking: 'LEXVN0988776615',
      note: 'Đơn Lazada Flash Sale 11.11 - Khách VIP Hà Nội',
      items: [
        {
          sku: 'DAM-RT-BE-S',
          name: 'Đầm Công Sở Nữ Routine Dáng Chữ A - Be / Size S',
          price: 680000,
          cost: 380000,
          qty: 1,
          variantId: ALL_VARIANTS[9].variantId,
          productId: ALL_VARIANTS[9].productId,
        },
        {
          sku: 'THUN-YD-TRANG-S',
          name: 'Áo Thun Nữ Yody Cotton Compact Mềm Mịn - Trắng / Size S',
          price: 229000,
          cost: 120000,
          qty: 2,
          variantId: ALL_VARIANTS[7].variantId,
          productId: ALL_VARIANTS[7].productId,
        },
      ],
    },
    {
      code: 'DH000014',
      extCode: 'LZD-8899202616',
      dayOffset: -1,
      hourVn: 15,
      cust: LAZADA_CUSTOMERS[4],
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      paymentMethod: 'COD',
      shippingFee: 15000,
      carrier: 'lex_vn',
      tracking: 'LEXVN0988776616',
      note: 'Đơn Lazada giao nhanh nội thành TP.HCM',
      items: [
        {
          sku: 'JEAN-RT-NAVY-M',
          name: 'Quần Jeans Nam Routine Slimfit Co Giãn - Xanh Navy / Size M',
          price: 590000,
          cost: 320000,
          qty: 1,
          variantId: ALL_VARIANTS[5].variantId,
          productId: ALL_VARIANTS[5].productId,
        },
      ],
    },
    {
      code: 'DH000015',
      extCode: 'LZD-8899202617',
      dayOffset: -2,
      hourVn: 9,
      cust: LAZADA_CUSTOMERS[5],
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      paymentMethod: 'MARKETPLACE',
      shippingFee: 18000,
      carrier: 'lex_vn',
      tracking: 'LEXVN0988776617',
      note: 'Đơn Lazada Mall - Thanh toán thẻ tín dụng trên Lazada',
      items: [
        {
          sku: 'DAM-RT-DEN-M',
          name: 'Đầm Công Sở Nữ Routine Dáng Chữ A - Đen / Size M',
          price: 680000,
          cost: 380000,
          qty: 1,
          variantId: ALL_VARIANTS[10].variantId,
          productId: ALL_VARIANTS[10].productId,
        },
        {
          sku: 'TUI-TTV-KEM-FS',
          name: 'Túi Xách Nữ Đeo Chéo Da Mềm - Trắng Kem / Freesize',
          price: 379000,
          cost: 210000,
          qty: 1,
          variantId: EXTRA_LAZADA_PRODUCTS[3].variantId,
          productId: EXTRA_LAZADA_PRODUCTS[3].productId,
        },
      ],
    },
    {
      code: 'DH000016',
      extCode: 'LZD-8899202618',
      dayOffset: -2,
      hourVn: 17,
      cust: LAZADA_CUSTOMERS[6],
      orderStatus: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'RESERVED',
      fulfillmentStage: 'SHIPPING',
      paymentMethod: 'COD',
      shippingFee: 28000,
      carrier: 'viettel_post',
      tracking: 'VTPLZD20260018',
      note: 'Đơn Lazada COD đang giao đi TP. Huế',
      items: [
        {
          sku: 'KHOAC-YD-NAVY-L',
          name: 'Áo Khoác Gió Unisex Chống Tia UV Yody - Xanh Navy / Size L',
          price: 499000,
          cost: 280000,
          qty: 1,
          variantId: ALL_VARIANTS[11].variantId,
          productId: ALL_VARIANTS[11].productId,
        },
      ],
    },
    {
      code: 'DH000017',
      extCode: 'LZD-8899202619',
      dayOffset: -3,
      hourVn: 11,
      cust: LAZADA_CUSTOMERS[7],
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      paymentMethod: 'MARKETPLACE',
      shippingFee: 0,
      carrier: 'lex_vn',
      tracking: 'LEXVN0988776619',
      note: 'Đơn Lazada Freeship Max - Khách Hạng Kim Cương',
      items: [
        {
          sku: 'SOMI-VT-TRANG-M',
          name: 'Áo Sơ Mi Nam Việt Tiến Dài Tay Bamboo - Trắng / Size M',
          price: 450000,
          cost: 260000,
          qty: 2,
          variantId: ALL_VARIANTS[3].variantId,
          productId: ALL_VARIANTS[3].productId,
        },
        {
          sku: 'BALO-CV-DEN-FS',
          name: 'Balo Laptop Canvas Chống Thấm 15.6 inch - Đen / Freesize',
          price: 420000,
          cost: 240000,
          qty: 1,
          variantId: ALL_VARIANTS[12].variantId,
          productId: ALL_VARIANTS[12].productId,
        },
      ],
    },
    {
      code: 'DH000018',
      extCode: 'LZD-8899202620',
      dayOffset: 0,
      hourVn: 4,
      cust: LAZADA_CUSTOMERS[8],
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'RESERVED',
      fulfillmentStage: 'PACKING',
      paymentMethod: 'MARKETPLACE',
      shippingFee: 24000,
      carrier: 'lex_vn',
      tracking: 'LEXVN0988776620',
      note: 'Đơn Lazada mới đồng bộ về sáng nay - Đang chuẩn bị hàng',
      items: [
        {
          sku: 'POLO-CM-NAVY-XL',
          name: 'Áo Polo Nam Coolmate Excool Khử Mùi - Xanh Navy / Size XL',
          price: 299000,
          cost: 165000,
          qty: 2,
          variantId: ALL_VARIANTS[2].variantId,
          productId: ALL_VARIANTS[2].productId,
        },
      ],
    },
  ];

  const salesClient = await createServiceClient(configs.sales);
  await withTenant(salesClient, IDS.tenant1, async (c) => {
    for (const o of salesOrdersLazada) {
      const orderId = detUuid(`order:t1:${o.code}`);
      const custId = detUuid(`customer:t1:${o.cust.code}`);
      const dateStr = vnDateString(o.dayOffset);
      const occurredIso = vnTimestamp(dateStr, o.hourVn, 15);
      const completedIso =
        o.orderStatus === 'COMPLETED'
          ? vnTimestamp(dateStr, o.hourVn, 45)
          : null;

      let subtotal = 0;
      let totalQty = 0;
      for (const it of o.items) {
        subtotal += it.price * it.qty;
        totalQty += it.qty;
      }
      const grandTotal = subtotal + o.shippingFee;
      const paidAmount = o.paymentStatus === 'PAID' ? grandTotal : 0;

      await c.query(
        `INSERT INTO sales.orders (
          id, tenant_id, code, branch_id, status, payment_method, customer_name,
          total_amount, item_count, created_by, created_at, idempotency_key,
          request_hash, channel_type, channel_id, source_connection_id, external_order_id,
          warehouse_id, customer_id, shift_id, order_status, payment_status,
          fulfillment_status, subtotal, item_discount_total, order_discount_type,
          order_discount_value, order_discount_total, promotion_discount_total,
          coupon_code, shipping_fee, tax_total, grand_total, paid_amount,
          refunded_amount, currency, note, version, updated_at, completed_at, fulfillment_stage
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,
          $13,'LAZADA',$14,$15,$16,
          $17,$18,null,$19,$20,
          $21,$22,0,'NONE',
          0,0,0,
          null,$23,0,$8,$24,
          0,'VND',$25,1,$11,$26,$27
        )
        ON CONFLICT (id) DO UPDATE SET
          external_order_id = EXCLUDED.external_order_id,
          customer_name = EXCLUDED.customer_name,
          total_amount = EXCLUDED.total_amount,
          grand_total = EXCLUDED.grand_total,
          order_status = EXCLUDED.order_status,
          fulfillment_status = EXCLUDED.fulfillment_status,
          fulfillment_stage = EXCLUDED.fulfillment_stage,
          updated_at = now()`,
        [
          orderId,
          IDS.tenant1,
          o.code,
          IDS.branchQ1,
          o.orderStatus.toLowerCase(),
          o.paymentMethod,
          o.cust.name,
          grandTotal,
          totalQty,
          IDS.accT1Cashier,
          occurredIso,
          detUuid(`order_idem:${o.code}`),
          sha256Fixed(`order_hash:${o.code}`),
          IDS.chLazada,
          IDS.connLazada,
          o.extCode,
          IDS.whQ1Main,
          custId,
          o.orderStatus,
          o.paymentStatus,
          o.fulfillmentStatus,
          subtotal,
          o.shippingFee,
          paidAmount,
          o.note,
          completedIso,
          o.fulfillmentStage,
        ],
      );

      for (let idx = 0; idx < o.items.length; idx++) {
        const it = o.items[idx];
        const lineId = detUuid(`oi:${o.code}:${idx + 1}`);
        const lineTotal = it.price * it.qty;
        await c.query(
          `INSERT INTO sales.order_items (
            id, tenant_id, order_id, sku, name, quantity, unit_price, line_total,
            variant_id, product_id, variant_label, unit_code, conversion_factor,
            qty, base_qty, line_gross, item_discount_type, item_discount_value,
            item_discount_amount, allocated_order_discount, line_net,
            unit_cost_snapshot, returned_qty, refunded_amount
          ) VALUES (
            $1,$2,$3,$4,$5::varchar,$6::int4,$7,$8::int8,
            $9,$10,$5::varchar,'Cái',1.0000,
            $6::numeric,$6::numeric,$8::int8,'NONE',0,
            0,0,$8::int8,
            $11,0,0
          )
          ON CONFLICT (id) DO NOTHING`,
          [
            lineId,
            IDS.tenant1,
            orderId,
            it.sku,
            it.name,
            it.qty,
            it.price,
            lineTotal,
            it.variantId,
            it.productId,
            it.cost,
          ],
        );
      }

      const ffId = detUuid(`fulfillment:${o.code}`);
      await c.query(
        `INSERT INTO sales.order_fulfillments (
          id, tenant_id, code, order_id, branch_id, warehouse_id,
          fulfillment_type, status, carrier_code, tracking_number,
          shipped_at, confirmed_at, created_by, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,'DELIVERY',$7,$8,$9,$10,$10,$11,$10)
        ON CONFLICT (id) DO NOTHING`,
        [
          ffId,
          IDS.tenant1,
          `GH-${o.code}`,
          orderId,
          IDS.branchQ1,
          IDS.whQ1Main,
          o.orderStatus === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED',
          o.carrier,
          o.tracking,
          occurredIso,
          IDS.accT1Cashier,
        ],
      );
    }
  });
  await salesClient.end();
  await custClient.end();
  console.log(
    '4/5 Lazada orders seeded into Sales schema (10 Lazada orders total).',
  );

  // 5. Seed All 18 Lazada SKU Mappings, Order Refs, Sync Jobs, Conflicts & Reconciliation Runs into Integration
  const intClient = await createServiceClient(configs.integration);
  await withTenant(intClient, IDS.tenant1, async (c) => {
    // Map all 14 base variants + 4 extra Lazada variants = 18 Lazada SKU mappings
    for (let i = 0; i < ALL_VARIANTS.length; i++) {
      const v = ALL_VARIANTS[i];
      const mapId = detUuid(`sku_map:lazada:${v.variantId}`);
      const itemNum = String(i + 1).padStart(2, '0');
      const lzdItemId = `135044020${itemNum}`;
      const lzdSkuId = `117553898${itemNum}`;
      // Add slight price variation on a couple items to showcase price comparison on UI
      const lzdPrice = i === 0 ? 289000 : i === 3 ? 465000 : v.basePrice;

      await c.query(
        `INSERT INTO integration.sku_mappings (
          id, tenant_id, connection_id, provider, external_item_id, external_sku_id,
          external_sku_code, external_product_name, internal_product_id, internal_variant_id,
          internal_sku_code, mapping_mode, status, listing_sync_status,
          external_price, last_synced_at, created_by, updated_by
        ) VALUES (
          $1,$2,$3,'LAZADA',$4,$5,
          $6::varchar,$7,$8,$9,
          $6::varchar,'EXACT_SKU_AUTO','ACTIVE','SYNCED',
          $10,now(),$11::varchar,$11::varchar
        )
        ON CONFLICT (id) DO UPDATE SET
          external_price = EXCLUDED.external_price,
          last_synced_at = now()`,
        [
          mapId,
          IDS.tenant1,
          IDS.connLazada,
          lzdItemId,
          lzdSkuId,
          v.skuCode,
          v.variantName,
          v.productId,
          v.variantId,
          lzdPrice,
          IDS.accT1Owner,
        ],
      );
    }

    for (const ep of EXTRA_LAZADA_PRODUCTS) {
      await c.query(
        `INSERT INTO integration.integration_catalog_variants (
          id, tenant_id, variant_id, product_id, sku_code, barcode, name, base_price, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET base_price = EXCLUDED.base_price`,
        [
          detUuid(`int_cat_var:${ep.variantId}`),
          IDS.tenant1,
          ep.variantId,
          ep.productId,
          ep.skuCode,
          ep.barcode,
          ep.variantName,
          ep.basePrice,
        ],
      );

      await c.query(
        `INSERT INTO integration.integration_stock_projections (
          id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty, available_qty, stock_version
        ) VALUES ($1,$2,$3,$4,$5::numeric,0,$5::int4,1)
        ON CONFLICT (id) DO UPDATE SET
          on_hand_qty = EXCLUDED.on_hand_qty,
          available_qty = EXCLUDED.available_qty`,
        [
          detUuid(`int_stock_proj:${IDS.whQ1Main}:${ep.variantId}`),
          IDS.tenant1,
          IDS.whQ1Main,
          ep.variantId,
          ep.qtyQ1,
        ],
      );

      const mapId = detUuid(`sku_map:lazada:${ep.variantId}`);
      await c.query(
        `INSERT INTO integration.sku_mappings (
          id, tenant_id, connection_id, provider, external_item_id, external_sku_id,
          external_sku_code, external_product_name, internal_product_id, internal_variant_id,
          internal_sku_code, mapping_mode, status, listing_sync_status,
          external_price, last_synced_at, created_by, updated_by
        ) VALUES (
          $1,$2,$3,'LAZADA',$4,$5,
          $6::varchar,$7,$8,$9,
          $6::varchar,'EXACT_SKU_AUTO','ACTIVE','SYNCED',
          $10,now(),$11::varchar,$11::varchar
        )
        ON CONFLICT (id) DO UPDATE SET
          external_price = EXCLUDED.external_price,
          last_synced_at = now()`,
        [
          mapId,
          IDS.tenant1,
          IDS.connLazada,
          ep.lzdItemId,
          ep.lzdSkuId,
          ep.skuCode,
          ep.variantName,
          ep.productId,
          ep.variantId,
          ep.lazadaPrice,
          IDS.accT1Owner,
        ],
      );
    }

    // Channel Order Refs for all new Lazada orders
    for (const o of salesOrdersLazada) {
      const subtotal = o.items.reduce((s, it) => s + it.price * it.qty, 0);
      await c.query(
        `INSERT INTO integration.channel_order_refs (
          id, tenant_id, connection_id, provider, external_shop_id, external_order_id,
          internal_order_id, internal_order_code, sync_status, external_status,
          normalized_status, status_rank, buyer_name, currency, total_amount,
          shipping_fee, payment_method, raw_order_snapshot
        ) VALUES (
          $1,$2,$3,'LAZADA','VN20269981',$4,
          $5,$6,'IMPORTED',$7,
          $8,$9,$10,'VND',$11,
          $12,$13,$14::jsonb
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`ch_order_ref:${o.code}`),
          IDS.tenant1,
          IDS.connLazada,
          o.extCode,
          detUuid(`order:t1:${o.code}`),
          o.code,
          o.orderStatus === 'COMPLETED'
            ? 'delivered'
            : o.fulfillmentStage === 'SHIPPING'
              ? 'shipped'
              : 'ready_to_ship',
          o.orderStatus === 'COMPLETED'
            ? 'DELIVERED'
            : o.fulfillmentStage === 'SHIPPING'
              ? 'SHIPPED'
              : 'READY_TO_SHIP',
          o.orderStatus === 'COMPLETED'
            ? 40
            : o.fulfillmentStage === 'SHIPPING'
              ? 30
              : 20,
          o.cust.name,
          subtotal + o.shippingFee,
          o.shippingFee,
          o.paymentMethod,
          JSON.stringify({
            order_id: o.extCode,
            platform: 'LAZADA',
            buyer: o.cust.name,
          }),
        ],
      );
    }

    // Extra Lazada Sync Jobs (PRODUCT_MAPPING_SYNC, ORDER_IMPORT, CONNECTION_TOKEN_REFRESH)
    const extraJobs = [
      {
        id: detUuid('sync_job:t1:lazada:prod:1'),
        code: 'JOB0004',
        type: 'PRODUCT_MAPPING_SYNC',
        idem: 'idem:job:lazada:prod:1',
        summary: {
          examinedListings: 18,
          syncedExistingMappings: 14,
          autoMappedCount: 4,
          unmappedCount: 0,
        },
        minsAgo: 8,
      },
      {
        id: detUuid('sync_job:t1:lazada:ord_imp:1'),
        code: 'JOB0005',
        type: 'ORDER_IMPORT',
        idem: 'idem:job:lazada:ord_imp:1',
        summary: {
          externalOrderId: 'LZD-8899202620',
          statusOutcome: 'IMPORTED',
          replayed: false,
        },
        minsAgo: 5,
      },
      {
        id: detUuid('sync_job:t1:lazada:token:1'),
        code: 'JOB0006',
        type: 'CONNECTION_TOKEN_REFRESH',
        idem: 'idem:job:lazada:token:1',
        summary: { refreshed: true, status: 'CONNECTED' },
        minsAgo: 3,
      },
    ];
    for (const jb of extraJobs) {
      await c.query(
        `INSERT INTO integration.sync_jobs (
          id, tenant_id, code, connection_id, provider, job_type,
          idempotency_key, status, priority, payload, result_summary,
          attempt_count, started_at, completed_at
        ) VALUES (
          $1,$2,$3,$4,'LAZADA',$5,
          $6,'COMPLETED',10,'{}'::jsonb,$7::jsonb,
          1,now() - ($8 || ' minutes')::interval,now() - ($8 || ' minutes')::interval
        )
        ON CONFLICT (id) DO UPDATE SET result_summary = EXCLUDED.result_summary`,
        [
          jb.id,
          IDS.tenant1,
          jb.code,
          IDS.connLazada,
          jb.type,
          jb.idem,
          JSON.stringify(jb.summary),
          String(jb.minsAgo),
        ],
      );
    }
  });
  await intClient.end();
  console.log(
    '5/5 Lazada SKU mappings (18), Order Refs (11), and Sync Jobs (6) seeded!',
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
