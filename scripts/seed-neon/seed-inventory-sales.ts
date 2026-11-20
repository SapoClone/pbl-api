import { Client } from 'pg';
import {
  ALL_VARIANTS,
  IDS,
  detUuid,
  sha256Fixed,
  vnDateString,
  vnTimestamp,
  withTenant,
} from './helpers';
import { CUSTOMERS_SEED } from './seed-platform-catalog-customer';

export interface SeededOrderLine {
  id: string;
  variantIdx: number;
  qty: number;
  discountAmount: number;
}

export interface SeededOrderDef {
  id: string;
  code: string;
  dayOffset: number;
  hourVn: number;
  branchId: string;
  warehouseId: string;
  channelType: 'POS' | 'WEBSITE' | 'SHOPEE' | 'LAZADA' | 'TIKTOK_SHOP';
  channelId: string;
  customerId: string;
  customerName: string;
  customerGroupCode: 'walk_in' | 'member' | 'vip' | 'wholesale';
  staffId: string;
  shiftId: string | null;
  paymentMethod:
    | 'CASH'
    | 'BANK_TRANSFER'
    | 'CARD'
    | 'COD'
    | 'MARKETPLACE'
    | 'ON_ACCOUNT';
  orderStatus: 'COMPLETED' | 'CONFIRMED' | 'PENDING' | 'CANCELLED';
  paymentStatus: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID';
  fulfillmentStatus: 'FULFILLED' | 'RESERVED' | 'UNFULFILLED';
  fulfillmentStage: 'PACKING' | 'SHIPPING' | null;
  exceptionCode?: 'sku_unmapped' | 'stock_shortage' | null;
  shippingFee: number;
  couponCode: string | null;
  promotionDiscount: number;
  carrierCode: string | null;
  trackingNumber: string | null;
  externalOrderId: string | null;
  sourceConnectionId: string | null;
  paidAmountOverride?: number;
  note: string;
  lines: SeededOrderLine[];
}

export function buildSeededOrders(): SeededOrderDef[] {
  return [
    // Day -6: POS Q1
    {
      id: detUuid('order:t1:DH000001'),
      code: 'DH000001',
      dayOffset: -6,
      hourVn: 10,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'POS',
      channelId: IDS.chPos,
      customerId: CUSTOMERS_SEED[0].id,
      customerName: CUSTOMERS_SEED[0].name,
      customerGroupCode: 'vip',
      staffId: IDS.accT1Cashier,
      shiftId: IDS.shiftClosed,
      paymentMethod: 'CASH',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: null,
      trackingNumber: null,
      externalOrderId: null,
      sourceConnectionId: null,
      note: 'Khách VIP mua tại quầy Quận 1',
      lines: [
        {
          id: detUuid('oi:DH000001:1'),
          variantIdx: 0,
          qty: 2,
          discountAmount: 0,
        }, // Áo Polo M Đen
        {
          id: detUuid('oi:DH000001:2'),
          variantIdx: 3,
          qty: 1,
          discountAmount: 0,
        }, // Sơ mi Việt Tiến M
      ],
    },
    // Day -5: Shopee Mall Order
    {
      id: detUuid('order:t1:DH000002'),
      code: 'DH000002',
      dayOffset: -5,
      hourVn: 14,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'SHOPEE',
      channelId: IDS.chShopee,
      customerId: CUSTOMERS_SEED[3].id,
      customerName: CUSTOMERS_SEED[3].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'COD',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 30000,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghn',
      trackingNumber: 'GHN8932026001',
      externalOrderId: '261108SHP88901',
      sourceConnectionId: IDS.connShopee,
      note: 'Đơn đồng bộ từ Shopee Official Mall - Giao hàng nhanh thu hộ COD',
      lines: [
        {
          id: detUuid('oi:DH000002:1'),
          variantIdx: 7,
          qty: 2,
          discountAmount: 0,
        }, // Áo thun nữ Yody S
        {
          id: detUuid('oi:DH000002:2'),
          variantIdx: 9,
          qty: 1,
          discountAmount: 0,
        }, // Đầm công sở Routine S
      ],
    },
    // Day -4: POS Q3
    {
      id: detUuid('order:t1:DH000003'),
      code: 'DH000003',
      dayOffset: -4,
      hourVn: 16,
      branchId: IDS.branchQ3,
      warehouseId: IDS.whQ3Main,
      channelType: 'POS',
      channelId: IDS.chPos,
      customerId: CUSTOMERS_SEED[1].id,
      customerName: CUSTOMERS_SEED[1].name,
      customerGroupCode: 'vip',
      staffId: IDS.accT1Manager,
      shiftId: null,
      paymentMethod: 'CARD',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: null,
      trackingNumber: null,
      externalOrderId: null,
      sourceConnectionId: null,
      note: 'Thanh toán thẻ Visa tại Chi nhánh Quận 3',
      lines: [
        {
          id: detUuid('oi:DH000003:1'),
          variantIdx: 5,
          qty: 2,
          discountAmount: 0,
        }, // Quần Jeans Routine M
        {
          id: detUuid('oi:DH000003:2'),
          variantIdx: 13,
          qty: 1,
          discountAmount: 0,
        }, // Thắt lưng Owen
      ],
    },
    // Day -3: Wholesale Order with partial payment (creates AR receivable)
    {
      id: detUuid('order:t1:DH000004'),
      code: 'DH000004',
      dayOffset: -3,
      hourVn: 11,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'POS',
      channelId: IDS.chPos,
      customerId: CUSTOMERS_SEED[4].id,
      customerName: CUSTOMERS_SEED[4].name,
      customerGroupCode: 'wholesale',
      staffId: IDS.accT1Manager,
      shiftId: null,
      paymentMethod: 'ON_ACCOUNT',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PARTIALLY_PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: null,
      trackingNumber: null,
      externalOrderId: null,
      sourceConnectionId: null,
      paidAmountOverride: 2000000,
      note: 'Đơn sỉ Shop Hùng Phát - Thanh toán trước 2.000.000đ, ghi nhận công nợ phần còn lại',
      lines: [
        {
          id: detUuid('oi:DH000004:1'),
          variantIdx: 1,
          qty: 5,
          discountAmount: 0,
        }, // 5x Polo L Đen (1.495.000)
        {
          id: detUuid('oi:DH000004:2'),
          variantIdx: 4,
          qty: 4,
          discountAmount: 0,
        }, // 4x Sơ mi L Trắng (1.800.000)
        {
          id: detUuid('oi:DH000004:3'),
          variantIdx: 6,
          qty: 2,
          discountAmount: 25000,
        }, // 2x Jeans L Đen (1.180.000 - 25.000 = 1.155.000) -> Total = 4.450.000! Paid 2.000.000 -> Debt = 2.450.000!
      ],
    },
    // Day -2: Website Order Completed
    {
      id: detUuid('order:t1:DH000005'),
      code: 'DH000005',
      dayOffset: -2,
      hourVn: 15,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'WEBSITE',
      channelId: IDS.chWebsite,
      customerId: CUSTOMERS_SEED[2].id,
      customerName: CUSTOMERS_SEED[2].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'BANK_TRANSFER',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 25000,
      couponCode: 'CHAOHE50K',
      promotionDiscount: 50000,
      carrierCode: 'ghtk',
      trackingNumber: 'GHTK202699812',
      externalOrderId: 'WEB-2026-005',
      sourceConnectionId: null,
      note: 'Đơn đặt qua Website VietFashion.vn - Áp mã CHAOHE50K',
      lines: [
        {
          id: detUuid('oi:DH000005:1'),
          variantIdx: 11,
          qty: 1,
          discountAmount: 0,
        }, // Áo khoác gió Yody (499.000)
        {
          id: detUuid('oi:DH000005:2'),
          variantIdx: 12,
          qty: 1,
          discountAmount: 0,
        }, // Balo Laptop Canvas (420.000)
      ],
    },
    // Day -1 (Yesterday): POS Q1 Completed #1 (hour 1 VN time)
    {
      id: detUuid('order:t1:DH000006'),
      code: 'DH000006',
      dayOffset: -1,
      hourVn: 1,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'POS',
      channelId: IDS.chPos,
      customerId: CUSTOMERS_SEED[5].id,
      customerName: CUSTOMERS_SEED[5].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Cashier,
      shiftId: IDS.shiftClosed,
      paymentMethod: 'CASH',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: null,
      trackingNumber: null,
      externalOrderId: null,
      sourceConnectionId: null,
      note: 'Đơn bán lẻ tại quầy Q01 ca hôm qua',
      lines: [
        {
          id: detUuid('oi:DH000006:1'),
          variantIdx: 10,
          qty: 1,
          discountAmount: 0,
        }, // Đầm công sở Đen M (680.000)
        {
          id: detUuid('oi:DH000006:2'),
          variantIdx: 8,
          qty: 2,
          discountAmount: 0,
        }, // Áo thun nữ Yody Be M (458.000)
      ],
    },
    // Day -1 (Yesterday): Shopee Order Completed #2 (hour 3 VN time)
    {
      id: detUuid('order:t1:DH000010'),
      code: 'DH000010',
      dayOffset: -1,
      hourVn: 3,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'SHOPEE',
      channelId: IDS.chShopee,
      customerId: CUSTOMERS_SEED[3].id,
      customerName: CUSTOMERS_SEED[3].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'MARKETPLACE',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghn',
      trackingNumber: 'GHN8932026010',
      externalOrderId: '261116SHP90112',
      sourceConnectionId: IDS.connShopee,
      note: 'Đơn Shopee Mall hoàn tất hôm qua',
      lines: [
        {
          id: detUuid('oi:DH000010:1'),
          variantIdx: 0,
          qty: 1,
          discountAmount: 0,
        }, // Polo M Đen (299.000)
        {
          id: detUuid('oi:DH000010:2'),
          variantIdx: 5,
          qty: 1,
          discountAmount: 0,
        }, // Quần Jeans M (590.000)
      ],
    },
    // Day -1 (Yesterday): POS Q3 Completed #3 (hour 5 VN time)
    {
      id: detUuid('order:t1:DH000011'),
      code: 'DH000011',
      dayOffset: -1,
      hourVn: 5,
      branchId: IDS.branchQ3,
      warehouseId: IDS.whQ3Main,
      channelType: 'POS',
      channelId: IDS.chPos,
      customerId: CUSTOMERS_SEED[7].id,
      customerName: CUSTOMERS_SEED[7].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Manager,
      shiftId: null,
      paymentMethod: 'CARD',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: null,
      trackingNumber: null,
      externalOrderId: null,
      sourceConnectionId: null,
      note: 'Khách mua tại Chi nhánh Quận 3 hôm qua',
      lines: [
        {
          id: detUuid('oi:DH000011:1'),
          variantIdx: 4,
          qty: 1,
          discountAmount: 0,
        }, // Sơ mi Việt Tiến L (450.000)
        {
          id: detUuid('oi:DH000011:2'),
          variantIdx: 7,
          qty: 1,
          discountAmount: 0,
        }, // Áo thun nữ Yody S (229.000)
      ],
    },
    // Day 0 (Today): POS Q1 Completed #1 (hour 0 VN time)
    {
      id: detUuid('order:t1:DH000007'),
      code: 'DH000007',
      dayOffset: 0,
      hourVn: 0,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'POS',
      channelId: IDS.chPos,
      customerId: CUSTOMERS_SEED[0].id,
      customerName: CUSTOMERS_SEED[0].name,
      customerGroupCode: 'vip',
      staffId: IDS.accT1Cashier,
      shiftId: IDS.shiftOpen,
      paymentMethod: 'BANK_TRANSFER',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: null,
      trackingNumber: null,
      externalOrderId: null,
      sourceConnectionId: null,
      note: 'Khách VIP thanh toán QR Vietcombank tại quầy Q01 hôm nay',
      lines: [
        {
          id: detUuid('oi:DH000007:1'),
          variantIdx: 2,
          qty: 2,
          discountAmount: 0,
        }, // 2x Polo Navy XL (598.000)
        {
          id: detUuid('oi:DH000007:2'),
          variantIdx: 5,
          qty: 1,
          discountAmount: 0,
        }, // 1x Quần Jeans Routine M (590.000)
        {
          id: detUuid('oi:DH000007:3'),
          variantIdx: 13,
          qty: 1,
          discountAmount: 0,
        }, // 1x Thắt lưng da bò Owen (350.000)
      ],
    },
    // Day 0 (Today): POS Q1 Completed #2 (Cash in open shift, hour 1 VN time)
    {
      id: detUuid('order:t1:DH000008'),
      code: 'DH000008',
      dayOffset: 0,
      hourVn: 1,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'POS',
      channelId: IDS.chPos,
      customerId: CUSTOMERS_SEED[6].id,
      customerName: CUSTOMERS_SEED[6].name,
      customerGroupCode: 'walk_in',
      staffId: IDS.accT1Cashier,
      shiftId: IDS.shiftOpen,
      paymentMethod: 'CASH',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: null,
      trackingNumber: null,
      externalOrderId: null,
      sourceConnectionId: null,
      note: 'Khách lẻ mua tiền mặt tại quầy Q01 hôm nay',
      lines: [
        {
          id: detUuid('oi:DH000008:1'),
          variantIdx: 3,
          qty: 1,
          discountAmount: 0,
        }, // 1x Sơ mi Việt Tiến M (450.000)
      ],
    },
    // Day 0 (Today): Shopee Mall Completed #3 (hour 2 VN time)
    {
      id: detUuid('order:t1:DH000012'),
      code: 'DH000012',
      dayOffset: 0,
      hourVn: 2,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'SHOPEE',
      channelId: IDS.chShopee,
      customerId: CUSTOMERS_SEED[1].id,
      customerName: CUSTOMERS_SEED[1].name,
      customerGroupCode: 'vip',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'MARKETPLACE',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghn',
      trackingNumber: 'GHN8932026012',
      externalOrderId: '261117SHP99201',
      sourceConnectionId: IDS.connShopee,
      note: 'Đơn hoả tốc Shopee Mall giao thành công sáng nay',
      lines: [
        {
          id: detUuid('oi:DH000012:1'),
          variantIdx: 6,
          qty: 2,
          discountAmount: 0,
        }, // 2x Quần Jeans Đen L (1.180.000)
      ],
    },
    // Day 0 (Today): TikTok Shop Completed #4 (hour 4 VN time)
    {
      id: detUuid('order:t1:DH000013'),
      code: 'DH000013',
      dayOffset: 0,
      hourVn: 4,
      branchId: IDS.branchQ3,
      warehouseId: IDS.whQ3Main,
      channelType: 'TIKTOK_SHOP',
      channelId: IDS.chTiktok,
      customerId: CUSTOMERS_SEED[7].id,
      customerName: CUSTOMERS_SEED[7].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Manager,
      shiftId: null,
      paymentMethod: 'MARKETPLACE',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghtk',
      trackingNumber: 'GHTK202699899',
      externalOrderId: 'TTS-20261117-01',
      sourceConnectionId: null,
      note: 'Đơn Livestream TikTok Shop hoàn tất tại Chi nhánh Quận 3',
      lines: [
        {
          id: detUuid('oi:DH000013:1'),
          variantIdx: 11,
          qty: 1,
          discountAmount: 0,
        }, // Áo khoác gió Yody (499.000)
        {
          id: detUuid('oi:DH000013:2'),
          variantIdx: 12,
          qty: 1,
          discountAmount: 0,
        }, // Balo Laptop Canvas (420.000)
      ],
    },
    // Day 0 (Today): Website Order Completed #5 (hour 6 VN time)
    {
      id: detUuid('order:t1:DH000014'),
      code: 'DH000014',
      dayOffset: 0,
      hourVn: 6,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'WEBSITE',
      channelId: IDS.chWebsite,
      customerId: CUSTOMERS_SEED[2].id,
      customerName: CUSTOMERS_SEED[2].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'BANK_TRANSFER',
      orderStatus: 'COMPLETED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      fulfillmentStage: null,
      shippingFee: 0,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'self_delivery',
      trackingNumber: 'SHIP-Q1-0014',
      externalOrderId: 'WEB-2026-014',
      sourceConnectionId: null,
      note: 'Đơn Website giao nhanh nội thành Quận 1',
      lines: [
        {
          id: detUuid('oi:DH000014:1'),
          variantIdx: 9,
          qty: 1,
          discountAmount: 0,
        }, // Đầm công sở Be S (680.000)
      ],
    },
    // Day 0 (Today): Lazada Order in CONFIRMED / PACKING state (Tab: Đang đóng gói)
    {
      id: detUuid('order:t1:DH000009'),
      code: 'DH000009',
      dayOffset: 0,
      hourVn: 6,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'LAZADA',
      channelId: IDS.chLazada,
      customerId: CUSTOMERS_SEED[5].id,
      customerName: CUSTOMERS_SEED[5].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'MARKETPLACE',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'RESERVED',
      fulfillmentStage: 'PACKING',
      shippingFee: 22000,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'viettel_post',
      trackingNumber: 'VTP202677819',
      externalOrderId: 'LZD-8899202611',
      sourceConnectionId: IDS.connLazada,
      note: 'Đơn Lazada Flagship đang đóng gói chờ bàn giao bưu tá',
      lines: [
        {
          id: detUuid('oi:DH000009:1'),
          variantIdx: 9,
          qty: 1,
          discountAmount: 0,
        }, // Đầm công sở Be S (680.000)
      ],
    },
    // Day 0 (Today): Website Order in PENDING state (Tab: Chờ xác nhận)
    {
      id: detUuid('order:t1:DH000015'),
      code: 'DH000015',
      dayOffset: 0,
      hourVn: 7,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'WEBSITE',
      channelId: IDS.chWebsite,
      customerId: CUSTOMERS_SEED[3].id,
      customerName: CUSTOMERS_SEED[3].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'COD',
      orderStatus: 'PENDING',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'UNFULFILLED',
      fulfillmentStage: null,
      shippingFee: 30000,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghn',
      trackingNumber: null,
      externalOrderId: 'WEB-2026-015',
      sourceConnectionId: null,
      note: 'Đơn hàng mới đặt trên Website chờ nhân viên gọi xác nhận',
      lines: [
        {
          id: detUuid('oi:DH000015:1'),
          variantIdx: 0,
          qty: 2,
          discountAmount: 0,
        }, // 2x Polo M Đen (598.000)
      ],
    },
    // Day 0 (Today): Shopee Order in CONFIRMED / UNFULFILLED state (Tab: Đã xác nhận)
    {
      id: detUuid('order:t1:DH000016'),
      code: 'DH000016',
      dayOffset: 0,
      hourVn: 7,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'SHOPEE',
      channelId: IDS.chShopee,
      customerId: CUSTOMERS_SEED[4].id,
      customerName: CUSTOMERS_SEED[4].name,
      customerGroupCode: 'wholesale',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'MARKETPLACE',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'RESERVED',
      fulfillmentStage: null,
      shippingFee: 25000,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghn',
      trackingNumber: null,
      externalOrderId: '261117SHP99502',
      sourceConnectionId: IDS.connShopee,
      note: 'Đơn Shopee đã xác nhận tồn kho, chờ chuyển sang đóng gói',
      lines: [
        {
          id: detUuid('oi:DH000016:1'),
          variantIdx: 3,
          qty: 2,
          discountAmount: 0,
        }, // 2x Sơ mi Việt Tiến M (900.000)
      ],
    },
    // Day 0 (Today): Order in CONFIRMED / SHIPPING state (Tab: Đang giao)
    {
      id: detUuid('order:t1:DH000017'),
      code: 'DH000017',
      dayOffset: 0,
      hourVn: 5,
      branchId: IDS.branchQ1,
      warehouseId: IDS.whQ1Main,
      channelType: 'WEBSITE',
      channelId: IDS.chWebsite,
      customerId: CUSTOMERS_SEED[1].id,
      customerName: CUSTOMERS_SEED[1].name,
      customerGroupCode: 'vip',
      staffId: IDS.accT1Cashier,
      shiftId: null,
      paymentMethod: 'COD',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'RESERVED',
      fulfillmentStage: 'SHIPPING',
      shippingFee: 30000,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghn',
      trackingNumber: 'GHN8932026017',
      externalOrderId: 'WEB-2026-017',
      sourceConnectionId: null,
      note: 'Đơn đang giao qua GHN, bưu tá đang phát tại Quận 3',
      lines: [
        {
          id: detUuid('oi:DH000017:1'),
          variantIdx: 10,
          qty: 1,
          discountAmount: 0,
        }, // Đầm công sở Đen M (680.000)
      ],
    },
    // Day 0 (Today): Order with exceptionCode = stock_shortage (Tab: Cần xử lý)
    {
      id: detUuid('order:t1:DH000018'),
      code: 'DH000018',
      dayOffset: 0,
      hourVn: 7,
      branchId: IDS.branchQ3,
      warehouseId: IDS.whQ3Main,
      channelType: 'SHOPEE',
      channelId: IDS.chShopee,
      customerId: CUSTOMERS_SEED[5].id,
      customerName: CUSTOMERS_SEED[5].name,
      customerGroupCode: 'member',
      staffId: IDS.accT1Manager,
      shiftId: null,
      paymentMethod: 'MARKETPLACE',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'UNFULFILLED',
      fulfillmentStage: null,
      exceptionCode: 'stock_shortage',
      shippingFee: 20000,
      couponCode: null,
      promotionDiscount: 0,
      carrierCode: 'ghtk',
      trackingNumber: null,
      externalOrderId: '261117SHP99888',
      sourceConnectionId: IDS.connShopee,
      note: 'Cần điều chuyển gấp Thắt lưng da bò Owen từ Kho Tân Bình sang CN Quận 3',
      lines: [
        {
          id: detUuid('oi:DH000018:1'),
          variantIdx: 13,
          qty: 2,
          discountAmount: 0,
        }, // 2x Thắt lưng Owen (700.000)
      ],
    },
  ];
}

export async function seedInventory(client: Client): Promise<void> {
  await withTenant(client, IDS.tenant1, async (c) => {
    // 1. Branch Projections
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
        `INSERT INTO inventory.branch_projection (
          branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,'active',now(),now())
        ON CONFLICT (branch_id) DO UPDATE SET name = EXCLUDED.name, synced_at = now()`,
        [b.id, IDS.tenant1, b.code, b.name, b.isWh],
      );
    }

    // 2. Catalog SKU Projection
    for (const v of ALL_VARIANTS) {
      await c.query(
        `INSERT INTO inventory.catalog_sku_projection (
          id, tenant_id, sku_id, product_id, sku_code, name, base_unit, barcode,
          base_price, status, aggregate_version, source_updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',1,now(),now())
        ON CONFLICT (id) DO UPDATE SET
          sku_code = EXCLUDED.sku_code,
          name = EXCLUDED.name,
          base_price = EXCLUDED.base_price,
          synced_at = now()`,
        [
          detUuid(`inv_sku_proj:${v.variantId}`),
          IDS.tenant1,
          v.variantId,
          v.productId,
          v.skuCode,
          v.variantName,
          v.baseUnit,
          v.barcode,
          v.basePrice,
        ],
      );
    }

    // 3. Warehouses (whTbMain uses kind = 'BRANCH' so StockViewsService includes Kho Tổng Tân Bình in branch stock summaries)
    const warehouses = [
      {
        id: IDS.whTbMain,
        branchId: IDS.branchKhoTb,
        code: 'KHO-TB-MAIN',
        name: 'Kho Tổng Tân Bình',
        isDefault: true,
        kind: 'BRANCH',
        address: 'Số 45 Cộng Hòa, Phường 4, Quận Tân Bình, TP. Hồ Chí Minh',
      },
      {
        id: IDS.whQ1Main,
        branchId: IDS.branchQ1,
        code: 'KHO-Q1-MAIN',
        name: 'Kho Bán Hàng Chi Nhánh Quận 1',
        isDefault: true,
        kind: 'BRANCH',
        address:
          'Số 128 Nguyễn Trãi, Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
      },
      {
        id: IDS.whQ3Main,
        branchId: IDS.branchQ3,
        code: 'KHO-Q3-MAIN',
        name: 'Kho Bán Hàng Chi Nhánh Quận 3',
        isDefault: true,
        kind: 'BRANCH',
        address: 'Số 245 Lê Văn Sỹ, Phường 14, Quận 3, TP. Hồ Chí Minh',
      },
      {
        id: IDS.whTbQuarantine,
        branchId: IDS.branchKhoTb,
        code: 'KHO-TB-LOI',
        name: 'Kho Hàng Lỗi & Chờ Bảo Hành',
        isDefault: false,
        kind: 'QUARANTINE',
        address:
          'Khu B - Số 45 Cộng Hòa, Phường 4, Quận Tân Bình, TP. Hồ Chí Minh',
      },
    ];
    for (const w of warehouses) {
      await c.query(
        `INSERT INTO inventory.warehouse (
          id, tenant_id, branch_id, code, name, is_default, status, kind, address
        ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$8)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          kind = EXCLUDED.kind,
          address = EXCLUDED.address,
          updated_at = now()`,
        [
          w.id,
          IDS.tenant1,
          w.branchId,
          w.code,
          w.name,
          w.isDefault,
          w.kind,
          w.address,
        ],
      );
    }

    // 4. Suppliers
    const suppliers = [
      {
        id: IDS.supVietThang,
        code: 'NCC0001',
        name: 'Tổng Công Ty Cổ Phần Dệt May Việt Thắng',
        phone: '02838960473',
        email: 'kinhdoanh@vietthang.com.vn',
        address:
          'Số 127 Lê Văn Chí, Phường Linh Trung, TP. Thủ Đức, TP. Hồ Chí Minh',
        taxCode: '0300399028',
        note: 'Nhà cung cấp vải & sơ mi Bamboo chiến lược',
      },
      {
        id: IDS.supNamSaiGon,
        code: 'NCC0002',
        name: 'Công Ty TNHH Sản Xuất Thời Trang Nam Sài Gòn',
        phone: '02837158899',
        email: 'sales@namsaigonfashion.vn',
        address:
          'KCN Tân Bình, Phường Tây Thạnh, Quận Tân Phú, TP. Hồ Chí Minh',
        taxCode: '0314558912',
        note: 'Chuyên gia công Áo Polo Excool và Quần Jeans',
      },
      {
        id: IDS.supDongA,
        code: 'NCC0003',
        name: 'Xưởng Phụ Kiện Da & Canvas Đông Á',
        phone: '02839612288',
        email: 'lienhe@phukiendonga.vn',
        address: 'Số 85 Lạc Long Quân, Phường 3, Quận 11, TP. Hồ Chí Minh',
        taxCode: '0316220194',
        note: 'Cung cấp Balo Canvas và Thắt lưng da bò thật',
      },
    ];
    for (const s of suppliers) {
      await c.query(
        `INSERT INTO inventory.supplier (
          id, tenant_id, code, name, phone, email, address, tax_code, note, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [
          s.id,
          IDS.tenant1,
          s.code,
          s.name,
          s.phone,
          s.email,
          s.address,
          s.taxCode,
          s.note,
        ],
      );
    }

    // 5. Purchase Orders (PO000001..PO000004) & Stock Receipt (PN000001)
    const po1Id = detUuid('po:t1:PO000001');
    const pn1Id = detUuid('receipt:t1:PN000001');
    const poTotal =
      120 * ALL_VARIANTS[0].unitCost +
      100 * ALL_VARIANTS[1].unitCost +
      90 * ALL_VARIANTS[3].unitCost; // 59.700.000

    await c.query(
      `INSERT INTO inventory.purchase_order (
        id, tenant_id, code, supplier_id, warehouse_id, status, total_amount,
        expected_date, note, approved_by, approved_at, created_by
      ) VALUES ($1,$2,'PO000001',$3,$4,'RECEIVED',$5,$6,'Đơn nhập hàng đầu vụ Thu Đông 2026',$7,now() - interval '7 days',$8)
      ON CONFLICT (id) DO UPDATE SET expected_date = EXCLUDED.expected_date`,
      [
        po1Id,
        IDS.tenant1,
        IDS.supVietThang,
        IDS.whTbMain,
        poTotal,
        vnDateString(-7),
        IDS.accT1Owner,
        IDS.accT1Warehouse,
      ],
    );

    const poLines = [
      { lineNo: 1, v: ALL_VARIANTS[0], qty: 120 },
      { lineNo: 2, v: ALL_VARIANTS[1], qty: 100 },
      { lineNo: 3, v: ALL_VARIANTS[3], qty: 90 },
    ];
    for (const l of poLines) {
      await c.query(
        `INSERT INTO inventory.purchase_order_item (
          id, tenant_id, purchase_order_id, line_no, sku_id, ordered_qty, received_qty,
          unit_cost, unit_name, conversion_factor
        ) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,1)
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`poi:PO000001:${l.lineNo}`),
          IDS.tenant1,
          po1Id,
          l.lineNo,
          l.v.variantId,
          l.qty,
          l.v.unitCost,
          l.v.baseUnit,
        ],
      );
    }

    // PO000002: PARTIALLY_RECEIVED (due in 2 days -> dueThisWeekCount)
    const po2Id = detUuid('po:t1:PO000002');
    await c.query(
      `INSERT INTO inventory.purchase_order (
        id, tenant_id, code, supplier_id, warehouse_id, status, total_amount,
        expected_date, note, approved_by, approved_at, created_by
      ) VALUES ($1,$2,'PO000002',$3,$4,'PARTIALLY_RECEIVED',32000000,$5,'Nhập bổ sung Quần Jeans Routine đợt 1 (Đã giao 50/100)',$6,now() - interval '2 days',$7)
      ON CONFLICT (id) DO UPDATE SET expected_date = EXCLUDED.expected_date, status = EXCLUDED.status`,
      [
        po2Id,
        IDS.tenant1,
        IDS.supNamSaiGon,
        IDS.whTbMain,
        vnDateString(2),
        IDS.accT1Owner,
        IDS.accT1Warehouse,
      ],
    );
    await c.query(
      `INSERT INTO inventory.purchase_order_item (
        id, tenant_id, purchase_order_id, line_no, sku_id, ordered_qty, received_qty,
        unit_cost, unit_name, conversion_factor
      ) VALUES ($1,$2,$3,1,$4,100,50,$5,$6,1)
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('poi:PO000002:1'),
        IDS.tenant1,
        po2Id,
        ALL_VARIANTS[5].variantId,
        ALL_VARIANTS[5].unitCost,
        ALL_VARIANTS[5].baseUnit,
      ],
    );

    // PO000003: APPROVED (awaiting delivery, due in 4 days -> awaitingDeliveryCount & dueThisWeekCount)
    const po3Id = detUuid('po:t1:PO000003');
    await c.query(
      `INSERT INTO inventory.purchase_order (
        id, tenant_id, code, supplier_id, warehouse_id, status, total_amount,
        expected_date, note, approved_by, approved_at, created_by
      ) VALUES ($1,$2,'PO000003',$3,$4,'APPROVED',21500000,$5,'Đặt bổ sung Balo Canvas & Thắt lưng da bò Owen cho CN Quận 1 & Quận 3',$6,now() - interval '1 day',$7)
      ON CONFLICT (id) DO UPDATE SET expected_date = EXCLUDED.expected_date, status = EXCLUDED.status`,
      [
        po3Id,
        IDS.tenant1,
        IDS.supDongA,
        IDS.whQ1Main,
        vnDateString(4),
        IDS.accT1Owner,
        IDS.accT1Manager,
      ],
    );
    await c.query(
      `INSERT INTO inventory.purchase_order_item (
        id, tenant_id, purchase_order_id, line_no, sku_id, ordered_qty, received_qty,
        unit_cost, unit_name, conversion_factor
      ) VALUES
        ($1,$2::uuid,$3::uuid,1,$4,50,0,$5,$6::varchar,1),
        ($7,$2::uuid,$3::uuid,2,$8,50,0,$9,$6::varchar,1)
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('poi:PO000003:1'),
        IDS.tenant1,
        po3Id,
        ALL_VARIANTS[12].variantId,
        ALL_VARIANTS[12].unitCost,
        ALL_VARIANTS[12].baseUnit,
        detUuid('poi:PO000003:2'),
        ALL_VARIANTS[13].variantId,
        ALL_VARIANTS[13].unitCost,
      ],
    );

    // PO000004: DRAFT (open PO waiting for owner approval)
    const po4Id = detUuid('po:t1:PO000004');
    await c.query(
      `INSERT INTO inventory.purchase_order (
        id, tenant_id, code, supplier_id, warehouse_id, status, total_amount,
        expected_date, note, created_by
      ) VALUES ($1,$2,'PO000004',$3,$4,'DRAFT',19000000,$5,'Dự trù nhập thêm Đầm công sở Nữ Routine chuẩn bị lễ cuối năm',$6)
      ON CONFLICT (id) DO UPDATE SET expected_date = EXCLUDED.expected_date, status = EXCLUDED.status`,
      [
        po4Id,
        IDS.tenant1,
        IDS.supNamSaiGon,
        IDS.whQ3Main,
        vnDateString(6),
        IDS.accT1Warehouse,
      ],
    );
    await c.query(
      `INSERT INTO inventory.purchase_order_item (
        id, tenant_id, purchase_order_id, line_no, sku_id, ordered_qty, received_qty,
        unit_cost, unit_name, conversion_factor
      ) VALUES ($1,$2,$3,1,$4,50,0,$5,$6,1)
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('poi:PO000004:1'),
        IDS.tenant1,
        po4Id,
        ALL_VARIANTS[10].variantId,
        ALL_VARIANTS[10].unitCost,
        ALL_VARIANTS[10].baseUnit,
      ],
    );

    await c.query(
      `INSERT INTO inventory.stock_receipt (
        id, tenant_id, code, warehouse_id, source_type, purchase_order_id, supplier_id,
        status, idempotency_key, note, posted_by, posted_at, created_by
      ) VALUES ($1,$2,'PN000001',$3,'PURCHASE_ORDER',$4,$5,'POSTED','idem:pn:PN000001','Nhập kho đủ hàng theo PO000001',$6,now() - interval '7 days',$6)
      ON CONFLICT (id) DO NOTHING`,
      [
        pn1Id,
        IDS.tenant1,
        IDS.whTbMain,
        po1Id,
        IDS.supVietThang,
        IDS.accT1Warehouse,
      ],
    );

    for (const l of poLines) {
      await c.query(
        `INSERT INTO inventory.stock_receipt_item (
          id, tenant_id, receipt_id, line_no, sku_id, qty, unit_cost, unit_name, conversion_factor
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`sri:PN000001:${l.lineNo}`),
          IDS.tenant1,
          pn1Id,
          l.lineNo,
          l.v.variantId,
          l.qty,
          l.v.unitCost,
          l.v.baseUnit,
        ],
      );
    }

    // 6. Stock Transfer (DC000001: Kho Tổng Tân Bình -> Kho CN Quận 1)
    const tf1Id = detUuid('transfer:t1:DC000001');
    await c.query(
      `INSERT INTO inventory.stock_transfer (
        id, tenant_id, code, from_warehouse_id, to_warehouse_id, status, note,
        dispatched_by, dispatched_at, received_by, received_at, created_by
      ) VALUES ($1,$2,'DC000001',$3,$4,'RECEIVED','Điều chuyển bổ sung hàng bán cuối tuần cho Chi nhánh Quận 1',$5,now() - interval '6 days',$6,now() - interval '6 days',$5)
      ON CONFLICT (id) DO NOTHING`,
      [
        tf1Id,
        IDS.tenant1,
        IDS.whTbMain,
        IDS.whQ1Main,
        IDS.accT1Warehouse,
        IDS.accT1Manager,
      ],
    );

    await c.query(
      `INSERT INTO inventory.stock_transfer_item (
        id, tenant_id, transfer_id, line_no, sku_id, transfer_qty, dispatched_qty,
        received_qty, discrepancy_qty, unit_cost
      ) VALUES ($1,$2,$3,1,$4,20,20,20,0,$5)
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('sti:DC000001:1'),
        IDS.tenant1,
        tf1Id,
        ALL_VARIANTS[0].variantId,
        ALL_VARIANTS[0].unitCost,
      ],
    );

    // 7. Stock Issue (PX000001: Xuất hàng mẫu trưng bày)
    const iss1Id = detUuid('issue:t1:PX000001');
    await c.query(
      `INSERT INTO inventory.stock_issue (
        id, tenant_id, code, warehouse_id, reason_code, status, idempotency_key,
        note, posted_by, posted_at, created_by
      ) VALUES ($1,$2,'PX000001',$3,'SAMPLE','POSTED','idem:px:PX000001','Xuất 2 áo Polo trưng bày Manocanh sảnh chính Q1',$4,now() - interval '5 days',$4)
      ON CONFLICT (id) DO NOTHING`,
      [iss1Id, IDS.tenant1, IDS.whQ1Main, IDS.accT1Manager],
    );

    await c.query(
      `INSERT INTO inventory.stock_issue_item (
        id, tenant_id, issue_id, line_no, sku_id, qty, unit_cost
      ) VALUES ($1,$2,$3,1,$4,2,$5)
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('sii:PX000001:1'),
        IDS.tenant1,
        iss1Id,
        ALL_VARIANTS[0].variantId,
        ALL_VARIANTS[0].unitCost,
      ],
    );

    // 8. Stock Take (KK000001: Kiểm kho định kỳ tại CN Quận 1)
    const st1Id = detUuid('stock_take:t1:KK000001');
    await c.query(
      `INSERT INTO inventory.stock_take (
        id, tenant_id, code, warehouse_id, status, freeze_movement, note,
        approved_by, approved_at, created_by
      ) VALUES ($1,$2,'KK000001',$3,'APPROVED',false,'Kiểm kê định kỳ hàng tháng tại Kho Chi nhánh Quận 1 - Khớp 100%',$4,now() - interval '2 days',$5)
      ON CONFLICT (id) DO NOTHING`,
      [st1Id, IDS.tenant1, IDS.whQ1Main, IDS.accT1Manager, IDS.accT1Warehouse],
    );

    await c.query(
      `INSERT INTO inventory.stock_take_item (
        id, tenant_id, stock_take_id, line_no, sku_id, snapshot_on_hand_qty,
        snapshot_reserved_qty, snapshot_version, counted_qty, variance_qty, reason
      ) VALUES ($1,$2,$3,1,$4,45,0,1,45,0,'Khớp tồn kho thực tế')
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('stki:KK000001:1'),
        IDS.tenant1,
        st1Id,
        ALL_VARIANTS[0].variantId,
      ],
    );

    // 9. Stock Thresholds, Stock Balances & Immutable Stock Balance Ledger
    for (const v of ALL_VARIANTS) {
      const whAllocations = [
        {
          whId: IDS.whTbMain,
          branchId: IDS.branchKhoTb,
          qty: v.initialQtyTb,
          reserved: 0,
          minQty: 20,
          maxQty: 300,
        },
        {
          whId: IDS.whQ1Main,
          branchId: IDS.branchQ1,
          qty: v.initialQtyQ1,
          reserved: v.variantId === ALL_VARIANTS[9].variantId ? 1 : 0, // 1 reserved for Lazada order DH000009
          minQty: 10,
          maxQty: 100,
        },
        {
          whId: IDS.whQ3Main,
          branchId: IDS.branchQ3,
          qty: v.initialQtyQ3,
          reserved: 0,
          minQty: 10,
          maxQty: 80,
        },
      ];

      for (const alloc of whAllocations) {
        await c.query(
          `INSERT INTO inventory.stock_threshold (
            id, tenant_id, warehouse_id, sku_id, min_qty, max_qty
          ) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO UPDATE SET
            min_qty = EXCLUDED.min_qty,
            max_qty = EXCLUDED.max_qty,
            updated_at = now()`,
          [
            detUuid(`thresh:${alloc.whId}:${v.variantId}`),
            IDS.tenant1,
            alloc.whId,
            v.variantId,
            alloc.minQty,
            alloc.maxQty,
          ],
        );

        const valuation = alloc.qty * v.unitCost;
        await c.query(
          `INSERT INTO inventory.stock_balance (
            id, tenant_id, warehouse_id, sku_id, on_hand_qty, reserved_qty,
            in_transit_qty, version, avg_unit_cost, valuation_amount
          ) VALUES ($1,$2,$3,$4,$5,$6,0,1,$7,$8)
          ON CONFLICT (id) DO UPDATE SET
            on_hand_qty = EXCLUDED.on_hand_qty,
            reserved_qty = EXCLUDED.reserved_qty,
            avg_unit_cost = EXCLUDED.avg_unit_cost,
            valuation_amount = EXCLUDED.valuation_amount,
            updated_at = now()`,
          [
            detUuid(`sbal:${alloc.whId}:${v.variantId}`),
            IDS.tenant1,
            alloc.whId,
            v.variantId,
            alloc.qty,
            alloc.reserved,
            v.unitCost,
            valuation,
          ],
        );

        // Append-only ledger: only insert when qty > 0 (CHK_stock_balance_ledger_nonzero)
        if (alloc.qty > 0) {
          await c.query(
            `INSERT INTO inventory.stock_balance_ledger (
              id, tenant_id, warehouse_id, sku_id, movement_type, qty_delta,
              on_hand_after, reserved_after, reference_type, reference_id,
              occurred_at, qty_before, unit_cost, avg_cost_after, actor_id, reason
            ) VALUES ($1,$2,$3,$4,'PURCHASE_RECEIPT',$5,$5,0,'STOCK_RECEIPT',$6,now() - interval '7 days',0,$7,$7,$8,'Nhập tồn kho đầu kỳ chuẩn hóa')
            ON CONFLICT (id) DO NOTHING`,
            [
              detUuid(`sb_ledger:init:${alloc.whId}:${v.variantId}`),
              IDS.tenant1,
              alloc.whId,
              v.variantId,
              alloc.qty,
              pn1Id,
              v.unitCost,
              IDS.accT1Warehouse,
            ],
          );
        }

        await c.query(
          `INSERT INTO inventory.stock_item (
            id, tenant_id, branch_id, sku, quantity_on_hand, quantity_reserved
          ) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO UPDATE SET
            quantity_on_hand = EXCLUDED.quantity_on_hand,
            quantity_reserved = EXCLUDED.quantity_reserved,
            updated_at = now()`,
          [
            detUuid(`stock_item:${alloc.branchId}:${v.skuCode}`),
            IDS.tenant1,
            alloc.branchId,
            v.skuCode,
            alloc.qty,
            alloc.reserved,
          ],
        );
      }
    }
  });
}

export async function seedSales(
  salesClient: Client,
  customerClient: Client,
): Promise<void> {
  // 1. Tenant Status (non-RLS table in sales)
  await salesClient.query(
    `INSERT INTO sales.tenant_status (
      tenant_id, status, plan_code, status_changed_at, plan_changed_at
    ) VALUES
      ($1,'active','pro',now(),now()),
      ($2,'active','basic',now(),now())
    ON CONFLICT (tenant_id) DO UPDATE SET
      status = 'active',
      plan_code = EXCLUDED.plan_code`,
    [IDS.tenant1, IDS.tenant2],
  );

  const orders = buildSeededOrders();

  await withTenant(salesClient, IDS.tenant1, async (c) => {
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
        `INSERT INTO sales.branch_projection (
          branch_id, tenant_id, code, name, is_warehouse, status, source_updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,'active',now(),now())
        ON CONFLICT (branch_id) DO UPDATE SET name = EXCLUDED.name, synced_at = now()`,
        [b.id, IDS.tenant1, b.code, b.name, b.isWh],
      );
    }

    // 3. Catalog Variant Projection & Branch Price Projection
    for (const v of ALL_VARIANTS) {
      await c.query(
        `INSERT INTO sales.catalog_variant_projection (
          id, tenant_id, variant_id, product_id, sku_code, barcode,
          product_name, variant_name, unit_code, conversion_factor, unit_price,
          status, aggregate_version, source_updated_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1.0000,$10,'ACTIVE',1,now(),now())
        ON CONFLICT (id) DO UPDATE SET
          unit_price = EXCLUDED.unit_price,
          variant_name = EXCLUDED.variant_name,
          synced_at = now()`,
        [
          detUuid(`sales_var_proj:${v.variantId}`),
          IDS.tenant1,
          v.variantId,
          v.productId,
          v.skuCode,
          v.barcode,
          v.productName,
          v.variantName,
          v.baseUnit,
          v.basePrice,
        ],
      );

      for (const bId of [IDS.branchQ1, IDS.branchQ3]) {
        await c.query(
          `INSERT INTO sales.catalog_branch_price_projection (
            id, tenant_id, variant_id, price_list_id, branch_id, price,
            start_date, end_date, is_active, list_version, aggregate_version,
            source_updated_at, synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,'2026-01-01','2026-12-31',true,1,1,now(),now())
          ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price, synced_at = now()`,
          [
            detUuid(`sales_bp_proj:${bId}:${v.variantId}`),
            IDS.tenant1,
            v.variantId,
            IDS.plDefault,
            bId,
            v.basePrice,
          ],
        );
      }
    }

    // 4. Sales Code Sequences
    const seqs = [
      { key: 'ORDER', val: 18 },
      { key: 'SHIFT', val: 2 },
      { key: 'FULFILLMENT', val: 18 },
      { key: 'RETURN', val: 1 },
    ];
    for (const s of seqs) {
      await c.query(
        `INSERT INTO sales.sales_code_sequence (id, tenant_id, seq_key, last_value)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET
           last_value = GREATEST(sales.sales_code_sequence.last_value, EXCLUDED.last_value)`,
        [detUuid(`sales_seq:t1:${s.key}`), IDS.tenant1, s.key, s.val],
      );
    }

    // 5. Sales Channels & Shipping Providers
    const channels = [
      { id: IDS.chPos, type: 'pos', name: 'Bán tại quầy (POS)', connId: null },
      {
        id: IDS.chWebsite,
        type: 'website',
        name: 'Website bán hàng',
        connId: null,
      },
      {
        id: IDS.chShopee,
        type: 'shopee',
        name: 'Shopee Official Mall',
        connId: IDS.connShopee,
      },
      {
        id: IDS.chLazada,
        type: 'lazada',
        name: 'Lazada Flagship Store',
        connId: IDS.connLazada,
      },
      {
        id: IDS.chTiktok,
        type: 'tiktok_shop',
        name: 'TikTok Shop',
        connId: null,
      },
      {
        id: IDS.chFacebook,
        type: 'facebook',
        name: 'Facebook Fanpage',
        connId: null,
      },
    ];
    for (const ch of channels) {
      await c.query(
        `INSERT INTO sales.sales_channels (
          id, tenant_id, type, name, status, environment, connection_id
        ) VALUES ($1,$2,$3,$4,'active','production',$5)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, connection_id = EXCLUDED.connection_id`,
        [ch.id, IDS.tenant1, ch.type, ch.name, ch.connId],
      );
    }

    const carriers = [
      {
        id: detUuid('carrier:t1:ghn'),
        code: 'ghn',
        name: 'Giao Hàng Nhanh (GHN)',
        type: 'express',
      },
      {
        id: detUuid('carrier:t1:ghtk'),
        code: 'ghtk',
        name: 'Giao Hàng Tiết Kiệm (GHTK)',
        type: 'standard',
      },
      {
        id: detUuid('carrier:t1:vtp'),
        code: 'viettel_post',
        name: 'Viettel Post',
        type: 'standard',
      },
      {
        id: detUuid('carrier:t1:self'),
        code: 'self_delivery',
        name: 'Nhân viên cửa hàng tự giao',
        type: 'internal',
      },
    ];
    for (const cr of carriers) {
      await c.query(
        `INSERT INTO sales.shipping_providers (id, tenant_id, code, name, type, status)
         VALUES ($1,$2,$3,$4,$5,'active')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [cr.id, IDS.tenant1, cr.code, cr.name, cr.type],
      );
    }

    // 6. Registers, Cash Setting, POS Shifts & Cash Entries
    const registers = [
      {
        id: IDS.regQ1_01,
        branchId: IDS.branchQ1,
        code: 'Q01',
        name: 'Quầy Thu Ngân Tầng Trệt - Quận 1',
      },
      {
        id: IDS.regQ1_02,
        branchId: IDS.branchQ1,
        code: 'Q02',
        name: 'Quầy Thu Ngân Lầu 1 - Quận 1',
      },
      {
        id: IDS.regQ3_01,
        branchId: IDS.branchQ3,
        code: 'Q03',
        name: 'Quầy Thu Ngân Chính - Quận 3',
      },
    ];
    for (const rg of registers) {
      await c.query(
        `INSERT INTO sales.registers (id, tenant_id, branch_id, code, name, status)
         VALUES ($1,$2,$3,$4,$5,'active')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [rg.id, IDS.tenant1, rg.branchId, rg.code, rg.name],
      );
    }

    await c.query(
      `INSERT INTO sales.cash_setting (
        id, tenant_id, tolerance_vnd, approval_above_vnd, responsibility,
        max_open_hours, max_opening_float_vnd, updated_by
      ) VALUES ($1,$2,10000,50000,'none',16,10000000,$3)
      ON CONFLICT (id) DO NOTHING`,
      [detUuid('cash_setting:t1'), IDS.tenant1, IDS.accT1Owner],
    );

    // Closed shift (yesterday) & Open shift (today)
    await c.query(
      `INSERT INTO sales.pos_shifts (
        id, tenant_id, code, branch_id, register_code, register_id, staff_id,
        status, opening_cash, cash_sales_total, cash_refunds_total, expected_cash,
        actual_cash, variance, open_note, close_note, closed_by, opened_at, closed_at,
        counted_by, counted_at, approved_by, approved_at, responsibility
      ) VALUES (
        $1,$2,'CA000001',$3,'Q01',$4,$5,
        'CLOSED',2000000,2186000,299000,3887000,
        3887000,0,'Nhận quỹ tiền mặt đầu ca sáng','Đã kiểm đếm khớp két tiền cuối ca',$6,
        now() - interval '1 day 8 hours', now() - interval '1 day 1 hour',
        $5, now() - interval '1 day 1 hour', $6, now() - interval '1 day 1 hour', 'none'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        IDS.shiftClosed,
        IDS.tenant1,
        IDS.branchQ1,
        IDS.regQ1_01,
        IDS.accT1Cashier,
        IDS.accT1Manager,
      ],
    );

    // Open shift (today): opening 2.000.000 + cash sale DH000008 (450.000) = 2.450.000
    await c.query(
      `INSERT INTO sales.pos_shifts (
        id, tenant_id, code, branch_id, register_code, register_id, staff_id,
        status, opening_cash, cash_sales_total, cash_refunds_total, expected_cash,
        open_note, opened_at
      ) VALUES (
        $1,$2,'CA000002',$3,'Q01',$4,$5,
        'OPEN',2000000,450000,0,2450000,
        'Mở ca bán hàng sáng hôm nay tại Quầy Q01', now() - interval '2 hours'
      )
      ON CONFLICT (id) DO UPDATE SET opened_at = now() - interval '2 hours'`,
      [
        IDS.shiftOpen,
        IDS.tenant1,
        IDS.branchQ1,
        IDS.regQ1_01,
        IDS.accT1Cashier,
      ],
    );

    // 7. Promotions & Coupons
    await c.query(
      `INSERT INTO sales.promotions (
        id, tenant_id, code, name, discount_type, discount_value,
        min_order_amount, max_discount_amount, starts_at, ends_at, status
      ) VALUES
        ($1,$2,'KM_CHAOHE','Ưu Đãi Thời Trang Việt - Giảm 50.000đ đơn từ 500K','FIXED',50000,500000,50000,now() - interval '30 days',now() + interval '60 days','ACTIVE'),
        ($3,$2,'KM_VIP10','Tri Ân Khách Hàng VIP - Giảm 10% tối đa 150K','PERCENT',10,1000000,150000,now() - interval '30 days',now() + interval '60 days','ACTIVE')
      ON CONFLICT (id) DO NOTHING`,
      [IDS.promoSummer, IDS.tenant1, IDS.promoVip],
    );

    await c.query(
      `INSERT INTO sales.coupons (
        id, tenant_id, promotion_id, code, max_uses, max_uses_per_customer, used_count, status
      ) VALUES
        ($1,$2,$3,'CHAOHE50K',500,3,1,'ACTIVE'),
        ($4,$2,$5,'VIP10',200,5,0,'ACTIVE')
      ON CONFLICT (id) DO NOTHING`,
      [
        IDS.couponSummer,
        IDS.tenant1,
        IDS.promoSummer,
        IDS.couponVip,
        IDS.promoVip,
      ],
    );

    // 8. Orders, Order Items, Tenders, Fulfillments, Status History
    for (const o of orders) {
      const dateStr = vnDateString(o.dayOffset);
      const occurredIso = vnTimestamp(dateStr, o.hourVn, 15);
      const completedIso =
        o.orderStatus === 'COMPLETED'
          ? vnTimestamp(dateStr, o.hourVn, 20)
          : null;

      let subtotal = 0;
      let itemDiscountTotal = 0;
      let totalQty = 0;
      for (const l of o.lines) {
        const v = ALL_VARIANTS[l.variantIdx];
        subtotal += v.basePrice * l.qty;
        itemDiscountTotal += l.discountAmount;
        totalQty += l.qty;
      }
      const grandTotal =
        subtotal - itemDiscountTotal - o.promotionDiscount + o.shippingFee;
      const paidAmount =
        o.paidAmountOverride !== undefined
          ? o.paidAmountOverride
          : o.paymentStatus === 'PAID'
            ? grandTotal
            : 0;
      const refundedAmount = o.code === 'DH000001' ? 299000 : 0;

      await c.query(
        `INSERT INTO sales.orders (
          id, tenant_id, code, branch_id, status, payment_method, customer_name,
          total_amount, item_count, created_by, created_at, idempotency_key,
          request_hash, channel_type, channel_id, source_connection_id, external_order_id,
          warehouse_id, customer_id, shift_id, order_status, payment_status,
          fulfillment_status, subtotal, item_discount_total, order_discount_type,
          order_discount_value, order_discount_total, promotion_discount_total,
          coupon_code, shipping_fee, tax_total, grand_total, paid_amount,
          refunded_amount, currency, note, version, updated_at, completed_at,
          fulfillment_stage, exception_code
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8::int8,$9,$10,$11::timestamptz,$12,
          $13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,
          $23,$24,$25,'NONE',
          0,0,$26,
          $27,$28,0,$8::int8,$29,
          $30,'VND',$31,1,$11::timestamptz,$32,$33,$34
        )
        ON CONFLICT (id) DO UPDATE SET
          created_at = EXCLUDED.created_at,
          completed_at = EXCLUDED.completed_at,
          updated_at = EXCLUDED.updated_at,
          order_status = EXCLUDED.order_status,
          payment_status = EXCLUDED.payment_status,
          fulfillment_status = EXCLUDED.fulfillment_status,
          fulfillment_stage = EXCLUDED.fulfillment_stage,
          exception_code = EXCLUDED.exception_code`,
        [
          o.id,
          IDS.tenant1,
          o.code,
          o.branchId,
          o.orderStatus.toLowerCase(),
          o.paymentMethod,
          o.customerName,
          grandTotal,
          totalQty,
          o.staffId,
          occurredIso,
          detUuid(`order_idem:${o.code}`),
          sha256Fixed(`order_hash:${o.code}`),
          o.channelType,
          o.channelId,
          o.sourceConnectionId,
          o.externalOrderId,
          o.warehouseId,
          o.customerId,
          o.shiftId,
          o.orderStatus,
          o.paymentStatus,
          o.fulfillmentStatus,
          subtotal,
          itemDiscountTotal,
          o.promotionDiscount,
          o.couponCode,
          o.shippingFee,
          paidAmount,
          refundedAmount,
          o.note,
          completedIso,
          o.fulfillmentStage,
          o.exceptionCode ?? null,
        ],
      );

      for (const l of o.lines) {
        const v = ALL_VARIANTS[l.variantIdx];
        const lineGross = v.basePrice * l.qty;
        const lineNet = lineGross - l.discountAmount;
        const retQty = o.code === 'DH000001' && l.variantIdx === 0 ? 1 : 0;
        const refAmt = o.code === 'DH000001' && l.variantIdx === 0 ? 299000 : 0;

        await c.query(
          `INSERT INTO sales.order_items (
            id, tenant_id, order_id, sku, name, quantity, unit_price, line_total,
            variant_id, product_id, variant_label, unit_code, conversion_factor,
            qty, base_qty, line_gross, item_discount_type, item_discount_value,
            item_discount_amount, allocated_order_discount, line_net,
            unit_cost_snapshot, returned_qty, refunded_amount
          ) VALUES (
            $1,$2,$3,$4,$5::varchar,$6::int4,$7,$8::int8,
            $9,$10,$5::varchar,$11,1.0000,
            $6::numeric,$6::numeric,$12,$13,$14::numeric,
            $14::int8,0,$8::int8,
            $15,$16,$17
          )
          ON CONFLICT (id) DO NOTHING`,
          [
            l.id,
            IDS.tenant1,
            o.id,
            v.skuCode,
            v.variantName,
            l.qty,
            v.basePrice,
            lineNet,
            v.variantId,
            v.productId,
            v.baseUnit,
            lineGross,
            l.discountAmount > 0 ? 'FIXED' : 'NONE',
            l.discountAmount,
            v.unitCost,
            retQty,
            refAmt,
          ],
        );
      }

      if (paidAmount > 0) {
        const tenderId = detUuid(`tender:${o.code}`);
        const tenderMethod =
          o.paymentMethod === 'ON_ACCOUNT' ? 'BANK_TRANSFER' : o.paymentMethod;
        await c.query(
          `INSERT INTO sales.order_tenders (
            id, tenant_id, order_id, shift_id, idempotency_key, method,
            amount, tendered_cash, change_due, status, confirmed_by, confirmed_at,
            kind, note, paid_at, created_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,0,'CONFIRMED',$9,$10,
            'PAYMENT',$11,$10,$10
          )
          ON CONFLICT (id) DO NOTHING`,
          [
            tenderId,
            IDS.tenant1,
            o.id,
            o.shiftId,
            `idem:tender:${o.code}`,
            tenderMethod,
            paidAmount,
            tenderMethod === 'CASH' ? paidAmount : 0,
            o.staffId,
            occurredIso,
            `Thanh toán đơn hàng ${o.code}`,
          ],
        );

        // If POS Cash sale in a shift, record append-only pos_shift_cash_entry
        if (o.shiftId && tenderMethod === 'CASH') {
          await c.query(
            `INSERT INTO sales.pos_shift_cash_entry (
              id, tenant_id, shift_id, branch_id, kind, amount, reason, note,
              order_id, tender_id, staff_id, occurred_at, recorded_at, source_key
            ) VALUES (
              $1,$2,$3,$4,'CASH_SALE',$5,'ORDER_PAYMENT',$6,
              $7,$8,$9,$10,$10,$11
            )
            ON CONFLICT (id) DO NOTHING`,
            [
              detUuid(`shift_cash_entry:${o.code}`),
              IDS.tenant1,
              o.shiftId,
              o.branchId,
              paidAmount,
              `Thu tiền mặt đơn hàng ${o.code}`,
              o.id,
              tenderId,
              o.staffId,
              occurredIso,
              `sale:${o.code}`,
            ],
          );
        }
      }

      // Order Fulfillment
      const ffId = detUuid(`fulfillment:${o.code}`);
      const ffType = o.channelType === 'POS' ? 'POS_PICKUP' : 'DELIVERY';
      const ffStatus =
        o.orderStatus === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED';
      await c.query(
        `INSERT INTO sales.order_fulfillments (
          id, tenant_id, code, order_id, branch_id, warehouse_id,
          fulfillment_type, status, carrier_code, tracking_number,
          shipped_at, confirmed_at, created_by, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,
          $11,$11,$12,$11
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          ffId,
          IDS.tenant1,
          `GH-${o.code}`,
          o.id,
          o.branchId,
          o.warehouseId,
          ffType,
          ffStatus,
          o.carrierCode,
          o.trackingNumber,
          occurredIso,
          o.staffId,
        ],
      );

      for (const l of o.lines) {
        const v = ALL_VARIANTS[l.variantIdx];
        await c.query(
          `INSERT INTO sales.fulfillment_items (
            id, tenant_id, fulfillment_id, order_item_id, sku_code, qty
          ) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO NOTHING`,
          [
            detUuid(`ffi:${o.code}:${l.id}`),
            IDS.tenant1,
            ffId,
            l.id,
            v.skuCode,
            l.qty,
          ],
        );
      }

      await c.query(
        `INSERT INTO sales.order_status_history (
          id, tenant_id, order_id, from_order_status, to_order_status,
          from_payment_status, to_payment_status, from_fulfillment_status,
          to_fulfillment_status, reason, actor_id, created_at
        ) VALUES ($1,$2,$3,'DRAFT',$4,'UNPAID',$5,'UNFULFILLED',$6,'Tạo và xác nhận đơn hàng',$7,$8)
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`osh:${o.code}`),
          IDS.tenant1,
          o.id,
          o.orderStatus,
          o.paymentStatus,
          o.fulfillmentStatus,
          o.staffId,
          occurredIso,
        ],
      );

      if (o.couponCode === 'CHAOHE50K') {
        await c.query(
          `INSERT INTO sales.coupon_usages (
            id, tenant_id, coupon_id, order_id, customer_id, discount_amount
          ) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (id) DO NOTHING`,
          [
            detUuid(`coupon_usage:${o.code}`),
            IDS.tenant1,
            IDS.couponSummer,
            o.id,
            o.customerId,
            o.promotionDiscount,
          ],
        );
      }
    }

    // 9. Sales Return TH000001 (Customer returns 1 Áo Polo from DH000001)
    const retId = detUuid('return:t1:TH000001');
    const retDateIso = vnTimestamp(vnDateString(-5), 11, 30);
    await c.query(
      `INSERT INTO sales.sales_returns (
        id, tenant_id, code, order_id, branch_id, warehouse_id, shift_id,
        status, total_refund_amount, note, requested_by, approved_by, received_by, created_at
      ) VALUES (
        $1,$2,'TH000001',$3,$4,$5,$6,
        'COMPLETED',299000,'Khách trả 1 Áo Polo Đen Size M do muốn đổi sang mẫu khác',
        $7,$8,$7,$9
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        retId,
        IDS.tenant1,
        detUuid('order:t1:DH000001'),
        IDS.branchQ1,
        IDS.whQ1Main,
        IDS.shiftClosed,
        IDS.accT1Cashier,
        IDS.accT1Manager,
        retDateIso,
      ],
    );

    await c.query(
      `INSERT INTO sales.sales_return_items (
        id, tenant_id, return_id, order_item_id, variant_id, sku_code,
        product_name, return_qty, unit_refund_amount, refund_amount, disposition, reason
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,1,299000,299000,'RESTOCK','Còn nguyên tem mác, nhập lại kho bán hàng'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('sri:TH000001:1'),
        IDS.tenant1,
        retId,
        detUuid('oi:DH000001:1'),
        ALL_VARIANTS[0].variantId,
        ALL_VARIANTS[0].skuCode,
        ALL_VARIANTS[0].variantName,
      ],
    );

    await c.query(
      `INSERT INTO sales.refund_requests (
        id, tenant_id, return_id, order_id, branch_id, shift_id,
        idempotency_key, amount, method, status, requested_by, confirmed_at, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        'idem:refund:TH000001',299000,'CASH','CONFIRMED',$7,$8,$8
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('refund_req:TH000001'),
        IDS.tenant1,
        retId,
        detUuid('order:t1:DH000001'),
        IDS.branchQ1,
        IDS.shiftClosed,
        IDS.accT1Cashier,
        retDateIso,
      ],
    );

    // Append-only cash refund entry in closed shift
    await c.query(
      `INSERT INTO sales.pos_shift_cash_entry (
        id, tenant_id, shift_id, branch_id, kind, amount, reason, note,
        order_id, return_id, staff_id, occurred_at, recorded_at, source_key
      ) VALUES (
        $1,$2,$3,$4,'CASH_REFUND',-299000,'RETURN_REFUND','Hoàn tiền mặt phiếu trả hàng TH000001',
        $5,$6,$7,$8,$8,'return:TH000001'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('shift_cash_entry:TH000001'),
        IDS.tenant1,
        IDS.shiftClosed,
        IDS.branchQ1,
        detUuid('order:t1:DH000001'),
        retId,
        IDS.accT1Cashier,
        retDateIso,
      ],
    );
  });

  // Sync Customer Purchase Projections in `customer` schema
  await withTenant(customerClient, IDS.tenant1, async (cc) => {
    for (const o of orders) {
      if (o.orderStatus !== 'COMPLETED') continue;
      const dateStr = vnDateString(o.dayOffset);
      const completedIso = vnTimestamp(dateStr, o.hourVn, 20);
      let subtotal = 0;
      let itemDisc = 0;
      for (const l of o.lines) {
        subtotal += ALL_VARIANTS[l.variantIdx].basePrice * l.qty;
        itemDisc += l.discountAmount;
      }
      const grandTotal =
        subtotal - itemDisc - o.promotionDiscount + o.shippingFee;
      const returnedAmt = o.code === 'DH000001' ? 299000 : 0;
      const netSpend = Math.max(0, grandTotal - o.shippingFee - returnedAmt);
      const earnedPts = Math.floor(netSpend / 10000);

      await cc.query(
        `INSERT INTO customer.customer_purchase_projections (
          id, tenant_id, customer_id, order_id, order_code, branch_id,
          channel_type, order_status, original_order_total, eligible_net_spend,
          returned_amount, earned_points, reversed_points, completed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'COMPLETED',$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO UPDATE SET
          completed_at = EXCLUDED.completed_at,
          updated_at = now()`,
        [
          detUuid(`cust_purch_proj:${o.code}`),
          IDS.tenant1,
          o.customerId,
          o.id,
          o.code,
          o.branchId,
          o.channelType,
          grandTotal,
          netSpend,
          returnedAmt,
          earnedPts,
          returnedAmt > 0 ? 29 : 0,
          completedIso,
        ],
      );
    }
  });
}
