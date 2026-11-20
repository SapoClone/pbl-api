import { Client } from 'pg';
import {
  ALL_VARIANTS,
  CATALOG_PRODUCTS,
  IDS,
  detUuid,
  encryptCredentialSecret,
  sha256Fixed,
  vnDateString,
  vnTimestamp,
  withTenant,
} from './helpers';
import { buildSeededOrders } from './seed-inventory-sales';
import { CUSTOMERS_SEED } from './seed-platform-catalog-customer';

const COA_ACCOUNTS = [
  {
    code: '1110',
    name: 'Quỹ tiền mặt tại cửa hàng',
    type: 'ASSET',
    side: 'DEBIT',
  },
  {
    code: '1111',
    name: 'Tiền mặt tại quầy thu ngân (POS)',
    type: 'ASSET',
    side: 'DEBIT',
  },
  {
    code: '1120',
    name: 'Tiền gửi ngân hàng & Ví điện tử',
    type: 'ASSET',
    side: 'DEBIT',
  },
  {
    code: '1130',
    name: 'Tiền đang chuyển (Cổng thanh toán)',
    type: 'ASSET',
    side: 'DEBIT',
  },
  {
    code: '1310',
    name: 'Phải thu khách hàng (Công nợ)',
    type: 'ASSET',
    side: 'DEBIT',
  },
  {
    code: '1311',
    name: 'Phải thu tiền thu hộ COD (ĐVVC)',
    type: 'ASSET',
    side: 'DEBIT',
  },
  { code: '1560', name: 'Hàng hóa tồn kho', type: 'ASSET', side: 'DEBIT' },
  {
    code: '2110',
    name: 'Phải trả nhà cung cấp',
    type: 'LIABILITY',
    side: 'CREDIT',
  },
  {
    code: '3311',
    name: 'Phải trả hoàn tiền khách hàng',
    type: 'LIABILITY',
    side: 'CREDIT',
  },
  {
    code: '5110',
    name: 'Doanh thu bán hàng & cung cấp dịch vụ',
    type: 'REVENUE',
    side: 'CREDIT',
  },
  {
    code: '5211',
    name: 'Chiết khấu thương mại & Khuyến mãi',
    type: 'CONTRA_REVENUE',
    side: 'DEBIT',
  },
  {
    code: '5212',
    name: 'Hàng bán bị trả lại',
    type: 'CONTRA_REVENUE',
    side: 'DEBIT',
  },
  {
    code: '6320',
    name: 'Giá vốn hàng bán (COGS)',
    type: 'EXPENSE',
    side: 'DEBIT',
  },
  {
    code: '6420',
    name: 'Chi phí vận hành & quản lý cửa hàng',
    type: 'EXPENSE',
    side: 'DEBIT',
  },
];

const CASHBOOK_CATEGORIES = [
  {
    code: 'THU_BAN_HANG',
    name: 'Thu tiền bán hàng',
    dir: 'RECEIPT',
    gl: '5110',
  },
  {
    code: 'THU_CONG_NO_KH',
    name: 'Thu nợ khách hàng',
    dir: 'RECEIPT',
    gl: '1310',
  },
  {
    code: 'THU_DOI_SOAT_COD',
    name: 'Thu tiền đối soát COD vận chuyển',
    dir: 'RECEIPT',
    gl: '1311',
  },
  {
    code: 'CHI_TRA_NCC',
    name: 'Chi trả tiền hàng nhà cung cấp',
    dir: 'EXPENSE',
    gl: '2110',
  },
  {
    code: 'CHI_HOAN_TIEN_KH',
    name: 'Chi hoàn tiền trả hàng cho khách',
    dir: 'EXPENSE',
    gl: '3311',
  },
  {
    code: 'CHI_VAN_HANH',
    name: 'Chi phí vận hành cửa hàng (Điện, Nước, Internet)',
    dir: 'EXPENSE',
    gl: '6420',
  },
];

export async function seedFinance(client: Client): Promise<void> {
  await withTenant(client, IDS.tenant1, async (c) => {
    // 1. Code Sequences
    const seqs = [
      { key: 'JOURNAL', val: 10 },
      { key: 'CASHBOOK', val: 6 },
      { key: 'RECEIVABLE', val: 2 },
      { key: 'PAYABLE', val: 2 },
      { key: 'COD', val: 2 },
      { key: 'SETTLEMENT', val: 8 },
    ];
    for (const s of seqs) {
      await c.query(
        `INSERT INTO finance.finance_code_sequence (id, tenant_id, seq_key, last_value)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET
           last_value = GREATEST(finance.finance_code_sequence.last_value, EXCLUDED.last_value)`,
        [detUuid(`fin_seq:t1:${s.key}`), IDS.tenant1, s.key, s.val],
      );
    }

    // 2. Financial Accounts (COA)
    const accIdByCode: Record<string, string> = {};
    for (const a of COA_ACCOUNTS) {
      const id = detUuid(`fin_acc:t1:${a.code}`);
      accIdByCode[a.code] = id;
      await c.query(
        `INSERT INTO finance.financial_accounts (
          id, tenant_id, code, name, account_type, normal_side, currency, is_system, status
        ) VALUES ($1,$2,$3,$4,$5,$6,'VND',true,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [id, IDS.tenant1, a.code, a.name, a.type, a.side],
      );
    }

    // 3. Cashbook Categories
    const catIdByCode: Record<string, string> = {};
    for (const cat of CASHBOOK_CATEGORIES) {
      const id = detUuid(`cb_cat:t1:${cat.code}`);
      catIdByCode[cat.code] = id;
      await c.query(
        `INSERT INTO finance.cashbook_categories (
          id, tenant_id, code, name, direction, gl_account_code, is_system, status
        ) VALUES ($1,$2,$3,$4,$5,$6,true,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
        [id, IDS.tenant1, cat.code, cat.name, cat.dir, cat.gl],
      );
    }

    // 4. Cash Accounts
    const cashDrawerQ1 = detUuid('cash_acc:t1:QUAY_Q1');
    const safeQ1 = detUuid('cash_acc:t1:KET_SAT_Q1');
    const bankVcb = detUuid('cash_acc:t1:VCB_HCM');
    const walletMomo = detUuid('cash_acc:t1:MOMO_DN');

    const cashAccounts = [
      {
        id: cashDrawerQ1,
        branchId: IDS.branchQ1,
        code: 'QUAY-Q01',
        name: 'Quỹ Tiền Mặt Quầy 01 (Chi nhánh Quận 1)',
        type: 'CASH_DRAWER',
        gl: '1111',
        balance: 6337000,
        bank: null,
        masked: null,
      },
      {
        id: safeQ1,
        branchId: IDS.branchQ1,
        code: 'KETSAT-Q1',
        name: 'Két Sắt Cửa Hàng Quận 1',
        type: 'SAFE',
        gl: '1110',
        balance: 45000000,
        bank: null,
        masked: null,
      },
      {
        id: bankVcb,
        branchId: IDS.branchQ1,
        code: 'NH-VCB-01',
        name: 'Tài Khoản Ngân Hàng Vietcombank - CN TP.HCM',
        type: 'BANK',
        gl: '1120',
        balance: 185400000,
        bank: 'Vietcombank',
        masked: '007100****8899',
      },
      {
        id: walletMomo,
        branchId: IDS.branchQ1,
        code: 'VI-MOMO-01',
        name: 'Ví Điện Tử MoMo Doanh Nghiệp',
        type: 'E_WALLET',
        gl: '1120',
        balance: 12500000,
        bank: 'MoMo Business',
        masked: '0901***567',
      },
    ];

    for (const ca of cashAccounts) {
      await c.query(
        `INSERT INTO finance.cash_accounts (
          id, tenant_id, branch_id, code, name, account_type, currency,
          gl_account_code, current_balance, status, bank_name, masked_account_number
        ) VALUES ($1,$2,$3,$4,$5,$6,'VND',$7,$8,'ACTIVE',$9,$10)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          current_balance = EXCLUDED.current_balance`,
        [
          ca.id,
          IDS.tenant1,
          ca.branchId,
          ca.code,
          ca.name,
          ca.type,
          ca.gl,
          ca.balance,
          ca.bank,
          ca.masked,
        ],
      );
    }

    // Helper for immutable double-entry journal insertion
    const insertJournal = async (params: {
      key: string;
      code: string;
      type: string;
      sourceType: string;
      sourceId: string;
      branchId: string;
      desc: string;
      lines: Array<{
        accCode: string;
        debit: number;
        credit: number;
        memo: string;
      }>;
    }): Promise<string> => {
      const jId = detUuid(`journal:t1:${params.key}`);
      const totalDebit = params.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = params.lines.reduce((s, l) => s + l.credit, 0);

      await c.query(
        `INSERT INTO finance.financial_journals (
          id, tenant_id, code, journal_type, source_type, source_id,
          idempotency_key, branch_id, currency, total_debit, total_credit,
          status, description, posted_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'VND',$9,$10,'POSTED',$11,$12)
        ON CONFLICT (id) DO NOTHING`,
        [
          jId,
          IDS.tenant1,
          params.code,
          params.type,
          params.sourceType,
          params.sourceId,
          `idem:journal:${params.key}`,
          params.branchId,
          totalDebit,
          totalCredit,
          params.desc,
          IDS.accT1Accountant,
        ],
      );

      for (let i = 0; i < params.lines.length; i++) {
        const ln = params.lines[i];
        await c.query(
          `INSERT INTO finance.financial_journal_lines (
            id, tenant_id, journal_id, line_no, account_id, account_code,
            debit_amount, credit_amount, branch_id, memo
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (id) DO NOTHING`,
          [
            detUuid(`jline:t1:${params.key}:${i + 1}`),
            IDS.tenant1,
            jId,
            i + 1,
            accIdByCode[ln.accCode],
            ln.accCode,
            ln.debit,
            ln.credit,
            params.branchId,
            ln.memo,
          ],
        );
      }
      return jId;
    };

    // 5. Seed Balanced Journals
    // J1: PO000001 Stock Receipt (59.700.000 VND)
    const jPo1 = await insertJournal({
      key: 'PN000001',
      code: 'BT000001',
      type: 'STOCK_RECEIPT',
      sourceType: 'STOCK_RECEIPT',
      sourceId: detUuid('receipt:t1:PN000001'),
      branchId: IDS.branchKhoTb,
      desc: 'Hạch toán nhập kho hàng hóa theo phiếu PN000001 (PO000001 - Dệt May Việt Thắng)',
      lines: [
        {
          accCode: '1560',
          debit: 59700000,
          credit: 0,
          memo: 'Tăng tồn kho hàng hóa Kho Tân Bình',
        },
        {
          accCode: '2110',
          debit: 0,
          credit: 59700000,
          memo: 'Ghi nhận công nợ phải trả NCC Dệt May Việt Thắng',
        },
      ],
    });

    // J2: Partial Payment to Supplier Viet Thang (30.000.000 VND)
    const jSupPay = await insertJournal({
      key: 'PC_NCC_01',
      code: 'BT000002',
      type: 'SUPPLIER_PAYMENT',
      sourceType: 'CASHBOOK_ENTRY',
      sourceId: detUuid('cb:t1:PC000001'),
      branchId: IDS.branchQ1,
      desc: 'Thanh toán đợt 1 tiền hàng PO000001 cho Công ty CP Dệt May Việt Thắng qua Vietcombank',
      lines: [
        {
          accCode: '2110',
          debit: 30000000,
          credit: 0,
          memo: 'Giảm công nợ phải trả NCC Việt Thắng',
        },
        {
          accCode: '1120',
          debit: 0,
          credit: 30000000,
          memo: 'Chi chuyển khoản từ TK Vietcombank',
        },
      ],
    });

    // J3: Wholesale Order DH000004 (Total 4.450.000 = Paid 2.000.000 + Receivable 2.450.000)
    const jWholesale = await insertJournal({
      key: 'DH000004',
      code: 'BT000003',
      type: 'SALES_REVENUE',
      sourceType: 'ORDER',
      sourceId: detUuid('order:t1:DH000004'),
      branchId: IDS.branchQ1,
      desc: 'Ghi nhận doanh thu & công nợ đơn hàng bán sỉ DH000004 (Shop Thời Trang Hùng Phát)',
      lines: [
        {
          accCode: '1120',
          debit: 2000000,
          credit: 0,
          memo: 'Thu chuyển khoản trả trước đơn DH000004',
        },
        {
          accCode: '1310',
          debit: 2450000,
          credit: 0,
          memo: 'Phải thu khách hàng Shop Hùng Phát',
        },
        {
          accCode: '5110',
          debit: 0,
          credit: 4450000,
          memo: 'Doanh thu bán hàng đơn sỉ DH000004',
        },
      ],
    });

    // J4: COD Settlement Batch for Shopee Order DH000002 (Expected COD 1.168.000, Fee 30.000, Net 1.138.000)
    const jCod = await insertJournal({
      key: 'COD000001',
      code: 'BT000004',
      type: 'COD_SETTLEMENT',
      sourceType: 'COD_BATCH',
      sourceId: detUuid('cod_batch:t1:COD000001'),
      branchId: IDS.branchQ1,
      desc: 'Đối soát và nhận tiền thu hộ COD từ Giao Hàng Nhanh (Đơn DH000002)',
      lines: [
        {
          accCode: '1120',
          debit: 1138000,
          credit: 0,
          memo: 'Thực nhận tiền COD về TK Vietcombank',
        },
        {
          accCode: '6420',
          debit: 30000,
          credit: 0,
          memo: 'Phí dịch vụ vận chuyển & thu hộ GHN',
        },
        {
          accCode: '1311',
          debit: 0,
          credit: 1168000,
          memo: 'Tất toán khoản phải thu COD đơn DH000002',
        },
      ],
    });

    // J5: Store Operating Expense (Điện + Internet 3.500.000 VND)
    const jOpEx = await insertJournal({
      key: 'PC000002',
      code: 'BT000005',
      type: 'CASHBOOK_VOUCHER',
      sourceType: 'CASHBOOK_ENTRY',
      sourceId: detUuid('cb:t1:PC000002'),
      branchId: IDS.branchQ1,
      desc: 'Chi thanh toán tiền điện và cáp quang Internet cửa hàng Quận 1',
      lines: [
        {
          accCode: '6420',
          debit: 3500000,
          credit: 0,
          memo: 'Chi phí điện & viễn thông tháng 11/2026',
        },
        {
          accCode: '1110',
          debit: 0,
          credit: 3500000,
          memo: 'Chi từ Két sắt cửa hàng Quận 1',
        },
      ],
    });

    // 6. Cashbook Entries
    const cbEntries = [
      {
        id: detUuid('cb:t1:PT000001'),
        code: 'PT000001',
        branchId: IDS.branchQ1,
        cashAccId: bankVcb,
        catId: catIdByCode['THU_BAN_HANG'],
        dir: 'RECEIPT',
        vType: 'AUTO_SALES',
        amount: 2000000,
        sourceType: 'ORDER',
        sourceId: detUuid('order:t1:DH000004'),
        partyType: 'CUSTOMER',
        partyId: CUSTOMERS_SEED[4].id,
        journalId: jWholesale,
        desc: 'Thu tiền cọc chuyển khoản đơn sỉ DH000004 - Shop Thời Trang Hùng Phát',
        refDoc: 'DH000004',
      },
      {
        id: detUuid('cb:t1:PT000002'),
        code: 'PT000002',
        branchId: IDS.branchQ1,
        cashAccId: bankVcb,
        catId: catIdByCode['THU_DOI_SOAT_COD'],
        dir: 'RECEIPT',
        vType: 'AUTO_COD',
        amount: 1138000,
        sourceType: 'COD_BATCH',
        sourceId: detUuid('cod_batch:t1:COD000001'),
        partyType: 'CARRIER',
        partyId: 'ghn',
        journalId: jCod,
        desc: 'Nhận tiền thanh toán đối soát COD kỳ 11/2026 từ Giao Hàng Nhanh (GHN)',
        refDoc: 'COD000001',
      },
      {
        id: detUuid('cb:t1:PC000001'),
        code: 'PC000001',
        branchId: IDS.branchQ1,
        cashAccId: bankVcb,
        catId: catIdByCode['CHI_TRA_NCC'],
        dir: 'EXPENSE',
        vType: 'SUPPLIER_PAYMENT',
        amount: 30000000,
        sourceType: 'SUPPLIER_PAYABLE',
        sourceId: detUuid('payable:t1:CN_NCC_01'),
        partyType: 'SUPPLIER',
        partyId: IDS.supVietThang,
        journalId: jSupPay,
        desc: 'Chi trả một phần công nợ đơn nhập hàng PO000001 cho Dệt May Việt Thắng',
        refDoc: 'PO000001',
      },
      {
        id: detUuid('cb:t1:PC000002'),
        code: 'PC000002',
        branchId: IDS.branchQ1,
        cashAccId: safeQ1,
        catId: catIdByCode['CHI_VAN_HANH'],
        dir: 'EXPENSE',
        vType: 'MANUAL',
        amount: 3500000,
        sourceType: 'MANUAL',
        sourceId: 'OPEX-2026-11',
        partyType: 'OTHER',
        partyId: 'EVN_HCMC',
        journalId: jOpEx,
        desc: 'Chi thanh toán hóa đơn tiền điện EVN TP.HCM và Internet Viettel tại CN Quận 1',
        refDoc: 'HD-EVN-112026',
      },
    ];

    for (const cb of cbEntries) {
      await c.query(
        `INSERT INTO finance.cashbook_entries (
          id, tenant_id, code, branch_id, cash_account_id, category_id,
          direction, voucher_type, amount, currency, status,
          source_type, source_id, party_type, party_id, journal_id,
          idempotency_key, description, reference_doc,
          created_by, approved_by, posted_by, approved_at, posted_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,'VND','POSTED',
          $10,$11,$12,$13,$14,
          $15,$16,$17,
          $18,$19,$18,now() - interval '2 days',now() - interval '2 days'
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          cb.id,
          IDS.tenant1,
          cb.code,
          cb.branchId,
          cb.cashAccId,
          cb.catId,
          cb.dir,
          cb.vType,
          cb.amount,
          cb.sourceType,
          cb.sourceId,
          cb.partyType,
          cb.partyId,
          cb.journalId,
          `idem:cb:${cb.code}`,
          cb.desc,
          cb.refDoc,
          IDS.accT1Accountant,
          IDS.accT1Owner,
        ],
      );
    }

    // 7. Customer Credit Profile, Receivable & Debt Ledger (Wholesale Customer KH000005)
    await c.query(
      `INSERT INTO finance.customer_credit_profiles (
        id, tenant_id, customer_id, credit_limit, posted_debt, held_credit, prepayment_balance, status
      ) VALUES ($1,$2,$3,50000000,2450000,0,0,'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET posted_debt = EXCLUDED.posted_debt`,
      [detUuid('credit_prof:t1:KH000005'), IDS.tenant1, CUSTOMERS_SEED[4].id],
    );

    const arId = detUuid('receivable:t1:PTU000001');
    await c.query(
      `INSERT INTO finance.customer_receivables (
        id, tenant_id, code, customer_id, order_id, branch_id,
        original_amount, paid_amount, adjusted_amount, outstanding_amount,
        currency, status, due_date, source_type, source_id, journal_id, idempotency_key
      ) VALUES (
        $1,$2,'PTU000001',$3,$4::uuid,$5,
        2450000,0,0,2450000,
        'VND','OPEN',now() + interval '30 days','ORDER',$4::varchar,$6,'idem:ar:DH000004'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        arId,
        IDS.tenant1,
        CUSTOMERS_SEED[4].id,
        detUuid('order:t1:DH000004'),
        IDS.branchQ1,
        jWholesale,
      ],
    );

    await c.query(
      `INSERT INTO finance.customer_debt_ledger (
        id, tenant_id, customer_id, receivable_id, entry_type,
        amount_delta, balance_before, balance_after, journal_id,
        reference_type, reference_id, idempotency_key, note, actor_id
      ) VALUES (
        $1,$2,$3,$4,'DEBT_RECOGNIZED',
        2450000,0,2450000,$5,
        'ORDER',$6,'idem:cdl:DH000004','Ghi nhận công nợ phải thu từ đơn sỉ DH000004',$7
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('cdl:t1:DH000004'),
        IDS.tenant1,
        CUSTOMERS_SEED[4].id,
        arId,
        jWholesale,
        detUuid('order:t1:DH000004'),
        IDS.accT1Accountant,
      ],
    );

    // 8. Supplier Payable & Debt Ledger (Supplier NCC0001 - Viet Thang: Original 59.700.000, Paid 30.000.000, Outstanding 29.700.000)
    const apId = detUuid('payable:t1:CN_NCC_01');
    await c.query(
      `INSERT INTO finance.supplier_payables (
        id, tenant_id, code, supplier_id, purchase_order_id, receipt_id, warehouse_id,
        original_amount, paid_amount, adjusted_amount, outstanding_amount,
        currency, status, due_date, source_type, source_id, journal_id, idempotency_key
      ) VALUES (
        $1,$2,'PTC000001',$3,$4,$5::uuid,$6,
        59700000,30000000,0,29700000,
        'VND','PARTIALLY_PAID',now() + interval '30 days','STOCK_RECEIPT',$5::varchar,$7,'idem:ap:PN000001'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        apId,
        IDS.tenant1,
        IDS.supVietThang,
        detUuid('po:t1:PO000001'),
        detUuid('receipt:t1:PN000001'),
        IDS.whTbMain,
        jPo1,
      ],
    );

    await c.query(
      `INSERT INTO finance.supplier_debt_ledger (
        id, tenant_id, supplier_id, payable_id, entry_type,
        amount_delta, balance_before, balance_after, payment_method,
        cashbook_entry_id, journal_id, reference_type, reference_id,
        idempotency_key, note, actor_id
      ) VALUES
        ($1,$2::uuid,$3::uuid,$4::uuid,'PAYABLE_RECOGNIZED',59700000,0,59700000,null,null,$5,'STOCK_RECEIPT',$6,'idem:sdl:1','Ghi nhận công nợ nhập hàng PN000001',$7::varchar),
        ($8,$2::uuid,$3::uuid,$4::uuid,'PAYMENT_APPLIED',-30000000,59700000,29700000,'BANK_TRANSFER',$9,$10,'CASHBOOK_ENTRY','PC000001','idem:sdl:2','Thanh toán đợt 1 qua Vietcombank',$7::varchar)
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('sdl:t1:1'),
        IDS.tenant1,
        IDS.supVietThang,
        apId,
        jPo1,
        detUuid('receipt:t1:PN000001'),
        IDS.accT1Accountant,
        detUuid('sdl:t1:2'),
        detUuid('cb:t1:PC000001'),
        jSupPay,
      ],
    );

    // 9. COD Receivable & Settlement Batch (Order DH000002)
    const codBatchId = detUuid('cod_batch:t1:COD000001');
    const codRecId = detUuid('cod_rec:t1:DH000002');

    await c.query(
      `INSERT INTO finance.cod_settlement_batches (
        id, tenant_id, code, carrier_code, statement_ref, file_checksum,
        cash_account_id, period_from, period_to,
        total_expected_cod, total_reported_cod, total_carrier_fee, total_net_payout,
        total_discrepancy, line_count, matched_count, discrepancy_count,
        status, journal_id, cashbook_entry_id, idempotency_key,
        imported_by, reconciled_by, reconciled_at
      ) VALUES (
        $1,$2,'COD000001','ghn','GHN-STMT-202611',$3,
        $4,now() - interval '7 days',now() - interval '1 day',
        1168000,1168000,30000,1138000,
        0,1,1,0,
        'RECONCILED',$5,$6,'idem:cod_batch:COD000001',
        $7::varchar,$7::varchar,now() - interval '1 day'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        codBatchId,
        IDS.tenant1,
        sha256Fixed('GHN-STMT-202611'),
        bankVcb,
        jCod,
        detUuid('cb:t1:PT000002'),
        IDS.accT1Accountant,
      ],
    );

    await c.query(
      `INSERT INTO finance.cod_receivables (
        id, tenant_id, code, order_id, fulfillment_id, branch_id,
        carrier_code, tracking_number, expected_cod_amount, reported_collected_amount,
        carrier_fee_amount, adjustment_amount, expected_net_amount, actual_remitted_amount,
        discrepancy_amount, status, settlement_batch_id, journal_id,
        delivered_at, reconciled_at
      ) VALUES (
        $1,$2,'CODR000001',$3,$4,$5,
        'ghn','GHN8932026001',1168000,1168000,
        30000,0,1138000,1138000,
        0,'RECONCILED',$6,$7,
        now() - interval '4 days',now() - interval '1 day'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        codRecId,
        IDS.tenant1,
        detUuid('order:t1:DH000002'),
        detUuid('fulfillment:DH000002'),
        IDS.branchQ1,
        codBatchId,
        jCod,
      ],
    );

    await c.query(
      `INSERT INTO finance.cod_settlement_lines (
        id, tenant_id, batch_id, line_no, cod_receivable_id, fulfillment_id,
        order_id, tracking_number, expected_cod_amount, reported_cod_amount,
        carrier_fee_amount, net_payout_amount, discrepancy_amount, line_status
      ) VALUES (
        $1,$2,$3,1,$4,$5,$6,'GHN8932026001',1168000,1168000,30000,1138000,0,'MATCHED'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('cod_line:t1:COD000001:1'),
        IDS.tenant1,
        codBatchId,
        codRecId,
        detUuid('fulfillment:DH000002'),
        detUuid('order:t1:DH000002'),
      ],
    );

    // 10. Shift Cash Reconciliation for Closed Shift CA000001
    await c.query(
      `INSERT INTO finance.shift_cash_reconciliations (
        id, tenant_id, shift_id, shift_code, branch_id, cash_account_id,
        staff_id, opening_cash, confirmed_cash_sales, confirmed_cash_refunds,
        other_cash_receipts, other_cash_expenses, expected_closing_cash,
        actual_counted_cash, variance_amount, status, reconciled_by
      ) VALUES (
        $1,$2,$3,'CA000001',$4,$5,
        $6,2000000,2186000,299000,
        0,0,3887000,
        3887000,0,'RECONCILED',$7
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('shift_recon:CA000001'),
        IDS.tenant1,
        IDS.shiftClosed,
        IDS.branchQ1,
        cashDrawerQ1,
        IDS.accT1Cashier,
        IDS.accT1Manager,
      ],
    );
  });
}

export async function seedIntegration(
  client: Client,
  masterKey: string,
): Promise<void> {
  // 1. Non-RLS tenant_status
  await client.query(
    `INSERT INTO integration.tenant_status (
      tenant_id, status, plan_code, status_changed_at, plan_changed_at
    ) VALUES
      ($1,'active','pro',now(),now()),
      ($2,'active','basic',now(),now())
    ON CONFLICT (tenant_id) DO UPDATE SET status = 'active', plan_code = EXCLUDED.plan_code`,
    [IDS.tenant1, IDS.tenant2],
  );

  await withTenant(client, IDS.tenant1, async (c) => {
    // 2. Code Sequences
    await c.query(
      `INSERT INTO integration.integration_code_sequence (id, tenant_id, seq_key, last_value)
       VALUES
         ($1,$2::uuid,'CONNECTION',2),
         ($3,$2::uuid,'SYNC_JOB',4)
       ON CONFLICT (id) DO NOTHING`,
      [detUuid('int_seq:t1:CONN'), IDS.tenant1, detUuid('int_seq:t1:JOB')],
    );

    // 3. Catalog Variants & Stock Projections
    for (const v of ALL_VARIANTS) {
      await c.query(
        `INSERT INTO integration.integration_catalog_variants (
          id, tenant_id, variant_id, product_id, sku_code, barcode, name, base_price, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET base_price = EXCLUDED.base_price`,
        [
          detUuid(`int_cat_var:${v.variantId}`),
          IDS.tenant1,
          v.variantId,
          v.productId,
          v.skuCode,
          v.barcode,
          v.variantName,
          v.basePrice,
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
          detUuid(`int_stock_proj:${IDS.whQ1Main}:${v.variantId}`),
          IDS.tenant1,
          IDS.whQ1Main,
          v.variantId,
          v.initialQtyQ1,
        ],
      );
    }

    // 4. Channel Connections & Encrypted Credentials (Shopee & Lazada)
    const connections = [
      {
        id: IDS.connShopee,
        code: 'KN0001',
        provider: 'SHOPEE',
        connKey: 'SHOPEE:88991102',
        shopId: '88991102',
        shopName: 'VietFashion Official Mall (Shopee)',
        partnerId: '2008899',
      },
      {
        id: IDS.connLazada,
        code: 'KN0002',
        provider: 'LAZADA',
        connKey: 'LAZADA:VN20269981',
        shopId: 'VN20269981',
        shopName: 'Thời Trang Việt Flagship (Lazada)',
        partnerId: '1007766',
      },
    ];

    for (const cn of connections) {
      await c.query(
        `INSERT INTO integration.channel_connections (
          id, tenant_id, code, provider, connection_key, external_shop_id,
          shop_name, branch_id, warehouse_id, status, safety_stock_buffer,
          stock_allocation_percent, last_sync_at, last_order_sync_at,
          last_inventory_sync_at, created_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,'CONNECTED',2,
          100,now() - interval '15 minutes',now() - interval '15 minutes',
          now() - interval '15 minutes',$10
        )
        ON CONFLICT (id) DO UPDATE SET
          shop_name = EXCLUDED.shop_name,
          status = 'CONNECTED',
          updated_at = now()`,
        [
          cn.id,
          IDS.tenant1,
          cn.code,
          cn.provider,
          cn.connKey,
          cn.shopId,
          cn.shopName,
          IDS.branchQ1,
          IDS.whQ1Main,
          IDS.accT1Owner,
        ],
      );

      const encAccess = encryptCredentialSecret(
        `access_token_${cn.provider.toLowerCase()}_live_2026`,
        masterKey,
        `${cn.id}:access`,
      );
      const encRefresh = encryptCredentialSecret(
        `refresh_token_${cn.provider.toLowerCase()}_live_2026`,
        masterKey,
        `${cn.id}:refresh`,
      );
      const encWebhook = encryptCredentialSecret(
        `webhook_secret_${cn.provider.toLowerCase()}_live_2026`,
        masterKey,
        `${cn.id}:webhook`,
      );

      await c.query(
        `INSERT INTO integration.connection_credentials (
          id, tenant_id, connection_id, credential_version,
          encrypted_access_token, encrypted_refresh_token, encrypted_webhook_secret,
          partner_id, key_version, access_token_expires_at, refresh_token_expires_at,
          scopes, last_refreshed_at
        ) VALUES (
          $1,$2,$3,1,
          $4,$5,$6,
          $7,1,now() + interval '7 days',now() + interval '30 days',
          'item.base,order.base,inventory.write',now()
        )
        ON CONFLICT (id) DO UPDATE SET
          encrypted_access_token = EXCLUDED.encrypted_access_token,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          encrypted_webhook_secret = EXCLUDED.encrypted_webhook_secret,
          access_token_expires_at = EXCLUDED.access_token_expires_at`,
        [
          detUuid(`conn_cred:${cn.id}`),
          IDS.tenant1,
          cn.id,
          encAccess,
          encRefresh,
          encWebhook,
          cn.partnerId,
        ],
      );
    }

    // 5. SKU Mappings & Inventory Publications
    for (let i = 0; i < 6; i++) {
      const v = ALL_VARIANTS[i];
      const mapId = detUuid(`sku_map:shopee:${v.variantId}`);
      const extItemId = `2990011${i}`;
      const extSkuId = `990011${i}`;

      await c.query(
        `INSERT INTO integration.sku_mappings (
          id, tenant_id, connection_id, provider, external_item_id, external_sku_id,
          external_sku_code, external_product_name, internal_product_id, internal_variant_id,
          internal_sku_code, mapping_mode, status, listing_sync_status,
          external_price, last_synced_at, created_by, updated_by
        ) VALUES (
          $1,$2,$3,'SHOPEE',$4,$5,
          $6::varchar,$7,$8,$9,
          $6::varchar,'AUTO_SKU','ACTIVE','SYNCED',
          $10,now(),$11::varchar,$11::varchar
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          mapId,
          IDS.tenant1,
          IDS.connShopee,
          extItemId,
          extSkuId,
          v.skuCode,
          v.variantName,
          v.productId,
          v.variantId,
          v.basePrice,
          IDS.accT1Owner,
        ],
      );

      await c.query(
        `INSERT INTO integration.channel_inventory_publications (
          id, tenant_id, connection_id, provider, mapping_id, internal_variant_id,
          external_item_id, external_sku_id, available_qty_snapshot,
          safety_buffer_snapshot, allocation_percent_snapshot, target_published_qty,
          last_confirmed_qty, stock_version, last_published_stock_version,
          status, attempt_count, published_at
        ) VALUES (
          $1,$2,$3,'SHOPEE',$4,$5,
          $6,$7,$8::int4,
          2,100,$9::int4,
          $9::int4,1,1,
          'SUCCEEDED',1,now() - interval '15 minutes'
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`inv_pub:shopee:${v.variantId}`),
          IDS.tenant1,
          IDS.connShopee,
          mapId,
          v.variantId,
          extItemId,
          extSkuId,
          v.initialQtyQ1,
          Math.max(0, v.initialQtyQ1 - 2),
        ],
      );
      const lzdMapId = detUuid(`sku_map:lazada:${v.variantId}`);
      const lzdItemId = `1350440200${i}`;
      const lzdSkuId = `11755389860${i}`;

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
        ON CONFLICT (id) DO NOTHING`,
        [
          lzdMapId,
          IDS.tenant1,
          IDS.connLazada,
          lzdItemId,
          lzdSkuId,
          v.skuCode,
          v.variantName,
          v.productId,
          v.variantId,
          v.basePrice,
          IDS.accT1Owner,
        ],
      );

      await c.query(
        `INSERT INTO integration.channel_inventory_publications (
          id, tenant_id, connection_id, provider, mapping_id, internal_variant_id,
          external_item_id, external_sku_id, available_qty_snapshot,
          safety_buffer_snapshot, allocation_percent_snapshot, target_published_qty,
          last_confirmed_qty, stock_version, last_published_stock_version,
          status, attempt_count, published_at
        ) VALUES (
          $1,$2,$3,'LAZADA',$4,$5,
          $6,$7,$8::int4,
          2,100,$9::int4,
          $9::int4,1,1,
          'SUCCEEDED',1,now() - interval '10 minutes'
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`inv_pub:lazada:${v.variantId}`),
          IDS.tenant1,
          IDS.connLazada,
          lzdMapId,
          v.variantId,
          lzdItemId,
          lzdSkuId,
          v.initialQtyQ1,
          Math.max(0, v.initialQtyQ1 - 2),
        ],
      );
    }

    // 6. Channel Order Refs, Sync Jobs, Conflicts, Reconciliation Runs, Cursors & Audit Logs
    const unmappedRefId = detUuid('ch_order_ref:LZD_UNMAPPED_01');
    await c.query(
      `INSERT INTO integration.channel_order_refs (
        id, tenant_id, connection_id, provider, external_shop_id, external_order_id,
        internal_order_id, internal_order_code, sync_status, external_status,
        normalized_status, status_rank, buyer_name, currency, total_amount,
        shipping_fee, payment_method, raw_order_snapshot
      ) VALUES
        (
          $1,$2::uuid,$3,'SHOPEE','88991102','261108SHP88901',
          $4,'DH000002','IMPORTED','COMPLETED',
          'DELIVERED',40,'Phạm Thu Hà','VND',1168000,
          30000,'COD','{"order_sn":"261108SHP88901","platform":"SHOPEE"}'::jsonb
        ),
        (
          $5,$2::uuid,$6,'LAZADA','VN20269981','LZD-8899202611',
          $7,'DH000009','IMPORTED','READY_TO_SHIP',
          'READY_TO_SHIP',20,'Vũ Thị Lan Anh','VND',702000,
          22000,'MARKETPLACE','{"order_number":"LZD-8899202611","platform":"LAZADA"}'::jsonb
        ),
        (
          $8,$2::uuid,$6,'LAZADA','VN20269981','LZD-8899202699',
          null,null,'MAPPING_REQUIRED','READY_TO_SHIP',
          'READY_TO_SHIP',20,'Nguyễn Quốc Bảo','VND',549000,
          20000,'COD','{"order_id":"LZD-8899202699","platform":"LAZADA"}'::jsonb
        )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('ch_order_ref:DH000002'),
        IDS.tenant1,
        IDS.connShopee,
        detUuid('order:t1:DH000002'),
        detUuid('ch_order_ref:DH000009'),
        IDS.connLazada,
        detUuid('order:t1:DH000009'),
        unmappedRefId,
      ],
    );

    const lzdJobPollId = detUuid('sync_job:t1:lazada:poll:1');
    const lzdJobInvId = detUuid('sync_job:t1:lazada:inv:1');
    await c.query(
      `INSERT INTO integration.sync_jobs (
        id, tenant_id, code, connection_id, provider, job_type,
        idempotency_key, status, priority, payload, result_summary,
        attempt_count, started_at, completed_at
      ) VALUES
        (
          $1,$2::uuid,'JOB0001',$3,'SHOPEE','ORDER_POLL',
          'idem:job:shopee:poll:1','COMPLETED',10,'{"windowMinutes":30}'::jsonb,'{"polledCount":3,"importedCount":1,"replayedCount":2}'::jsonb,
          1,now() - interval '15 minutes',now() - interval '14 minutes'
        ),
        (
          $4,$2::uuid,'JOB0002',$5,'LAZADA','ORDER_POLL',
          'idem:job:lazada:poll:1','COMPLETED',10,'{"windowMinutes":60}'::jsonb,'{"polledCount":5,"importedCount":3,"replayedCount":2}'::jsonb,
          1,now() - interval '12 minutes',now() - interval '11 minutes'
        ),
        (
          $6,$2::uuid,'JOB0003',$5,'LAZADA','INVENTORY_PUBLICATION',
          'idem:job:lazada:inv:1','COMPLETED',10,'{}'::jsonb,'{"totalMappings":6,"publishedCount":6,"skippedStaleCount":0}'::jsonb,
          1,now() - interval '10 minutes',now() - interval '9 minutes'
        )
      ON CONFLICT (id) DO UPDATE SET
        result_summary = EXCLUDED.result_summary`,
      [
        detUuid('sync_job:t1:1'),
        IDS.tenant1,
        IDS.connShopee,
        lzdJobPollId,
        IDS.connLazada,
        lzdJobInvId,
      ],
    );

    await c.query(
      `INSERT INTO integration.sync_conflicts (
        id, tenant_id, code, connection_id, provider, conflict_type,
        severity, status, external_order_id, external_item_id, external_sku_id,
        channel_order_ref_id, sync_job_id, details
      ) VALUES (
        $1,$2,'CNF0001',$3,'LAZADA','SKU_UNMAPPED',
        'HIGH','OPEN','LZD-8899202699','13504499001','11755399001',
        $4,$5,'{"buyerName":"Nguyễn Quốc Bảo","externalSkuCode":"SM-LINEN-BE-XL","reason":"Mã ShopSKU 13504499001_VNAMZ-11755399001 trên Lazada chưa được liên kết với biến thể Catalog nội bộ"}'::jsonb
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('sync_conflict:t1:lazada:1'),
        IDS.tenant1,
        IDS.connLazada,
        unmappedRefId,
        lzdJobPollId,
      ],
    );

    const recRunId = detUuid('recon_run:t1:lazada:1');
    await c.query(
      `INSERT INTO integration.reconciliation_runs (
        id, tenant_id, code, connection_id, provider, run_type,
        status, window_start, window_end, records_examined,
        matched_count, mismatch_count, auto_recovered_count,
        started_at, completed_at, triggered_by
      ) VALUES (
        $1,$2,'REC0001',$3,'LAZADA','INCREMENTAL',
        'COMPLETED',now() - interval '24 hours',now() - interval '5 minutes',14,
        13,0,1,
        now() - interval '6 minutes',now() - interval '5 minutes',$4
      )
      ON CONFLICT (id) DO NOTHING`,
      [recRunId, IDS.tenant1, IDS.connLazada, IDS.accT1Owner],
    );

    await c.query(
      `INSERT INTO integration.reconciliation_issues (
        id, tenant_id, run_id, connection_id, provider, issue_type,
        severity, external_ref, internal_ref, expected_state, observed_state,
        status, resolution_notes, resolved_by, resolved_at
      ) VALUES (
        $1,$2,$3,$4,'LAZADA','MISSED_WEBHOOK_ORDER_RECOVERED',
        'MEDIUM','LZD-8899202611','DH000009','{"importedViaWebhook":true}'::jsonb,'{"recoveredOrderCount":1}'::jsonb,
        'RESOLVED','Đã tự động tải bù 1 đơn hàng Lazada (LZD-8899202611 -> DH000009) qua quét đối soát định kỳ','auto-reconciler',now() - interval '5 minutes'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('recon_issue:t1:lazada:1'),
        IDS.tenant1,
        recRunId,
        IDS.connLazada,
      ],
    );

    await c.query(
      `INSERT INTO integration.sync_cursors (
        id, tenant_id, connection_id, provider, cursor_type, cursor_value, last_synced_at
      ) VALUES
        ($1,$2::uuid,$3,'SHOPEE','ORDER_POLL','1731420000',now() - interval '15 minutes'),
        ($4,$2::uuid,$5,'LAZADA','ORDER_POLL','1731420000',now() - interval '15 minutes')
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('cursor:shopee:order'),
        IDS.tenant1,
        IDS.connShopee,
        detUuid('cursor:lazada:order'),
        IDS.connLazada,
      ],
    );

    await c.query(
      `INSERT INTO integration.integration_audit_logs (
        id, tenant_id, connection_id, actor_id, action, target_type, target_id, metadata
      ) VALUES (
        $1,$2,$3::uuid,$4,'CONNECTION_AUTHORIZED','CHANNEL_CONNECTION',$3::varchar,
        '{"shopName":"VietFashion Official Mall (Shopee)","provider":"SHOPEE"}'::jsonb
      )
      ON CONFLICT (id) DO NOTHING`,
      [detUuid('int_audit:t1:1'), IDS.tenant1, IDS.connShopee, IDS.accT1Owner],
    );
  });
}

export async function seedInsight(client: Client): Promise<void> {
  const orders = buildSeededOrders();
  const today = vnDateString(0);

  await withTenant(client, IDS.tenant1, async (c) => {
    // 1. Projection Checkpoints & Generations
    const projNames = ['sales_analytics', 'inventory_analytics'];
    for (const pName of projNames) {
      await c.query(
        `INSERT INTO insight.projection_checkpoints (
          id, tenant_id, projection_name, active_generation_id,
          last_event_id, last_event_type, last_event_occurred_at,
          last_processed_at, projection_version, events_processed_count, status
        ) VALUES ($1,$2,$3,'gen-active',$4,'sales.order.completed',now(),now(),12,25,'HEALTHY')
        ON CONFLICT (id) DO UPDATE SET
          active_generation_id = 'gen-active',
          last_processed_at = now(),
          status = 'HEALTHY',
          updated_at = now()`,
        [
          detUuid(`proj_cp:t1:${pName}`),
          IDS.tenant1,
          pName,
          detUuid('evt:last'),
        ],
      );

      await c.query(
        `INSERT INTO insight.projection_generations (
          id, tenant_id, projection_name, generation_id, status,
          from_date, to_date, orders_replayed, returns_replayed,
          triggered_by, reason, started_at, completed_at
        ) VALUES ($1,$2,$3,'gen-active','ACTIVE',$4,$5,9,1,'system','Khởi tạo dữ liệu báo cáo tiếng Việt chuẩn',now(),now())
        ON CONFLICT (id) DO UPDATE SET
          status = 'ACTIVE',
          to_date = EXCLUDED.to_date,
          completed_at = now()`,
        [
          detUuid(`proj_gen:t1:${pName}`),
          IDS.tenant1,
          pName,
          vnDateString(-6),
          today,
        ],
      );
    }

    // 2. Dimension Caches (BRANCH, WAREHOUSE, PRODUCT, VARIANT, CUSTOMER)
    const dims: Array<{
      type: string;
      entityId: string;
      code: string;
      name: string;
      catId?: string | null;
      brandId?: string | null;
      groupId?: string | null;
    }> = [
      {
        type: 'BRANCH',
        entityId: IDS.branchQ1,
        code: 'CN-Q1',
        name: 'Chi nhánh Quận 1 - Nguyễn Trãi',
      },
      {
        type: 'BRANCH',
        entityId: IDS.branchQ3,
        code: 'CN-Q3',
        name: 'Chi nhánh Quận 3 - Lê Văn Sỹ',
      },
      {
        type: 'BRANCH',
        entityId: IDS.branchKhoTb,
        code: 'KHO-TB',
        name: 'Kho Tổng Tân Bình',
      },
      {
        type: 'WAREHOUSE',
        entityId: IDS.whTbMain,
        code: 'KHO-TB-MAIN',
        name: 'Kho Tổng Tân Bình',
      },
      {
        type: 'WAREHOUSE',
        entityId: IDS.whQ1Main,
        code: 'KHO-Q1-MAIN',
        name: 'Kho Bán Hàng Chi Nhánh Quận 1',
      },
      {
        type: 'WAREHOUSE',
        entityId: IDS.whQ3Main,
        code: 'KHO-Q3-MAIN',
        name: 'Kho Bán Hàng Chi Nhánh Quận 3',
      },
      ...CATALOG_PRODUCTS.map((p) => ({
        type: 'PRODUCT',
        entityId: p.productId,
        code: p.code,
        name: p.name,
        catId: p.categoryId,
        brandId: p.brandId,
      })),
      ...ALL_VARIANTS.map((v) => ({
        type: 'VARIANT',
        entityId: v.variantId,
        code: v.skuCode,
        name: v.variantName,
        catId: v.categoryId,
        brandId: v.brandId,
      })),
      ...CUSTOMERS_SEED.map((cu) => ({
        type: 'CUSTOMER',
        entityId: cu.id,
        code: cu.code,
        name: cu.name,
        groupId: cu.groupId,
      })),
    ];

    for (const d of dims) {
      await c.query(
        `INSERT INTO insight.insight_dimension_caches (
          id, tenant_id, dimension_type, entity_id, code, name,
          category_id, brand_id, customer_group_id, aggregate_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          code = EXCLUDED.code,
          updated_at = now()`,
        [
          detUuid(`dim:${d.type}:${d.entityId}`),
          IDS.tenant1,
          d.type,
          d.entityId,
          d.code,
          d.name,
          d.catId ?? null,
          d.brandId ?? null,
          d.groupId ?? null,
        ],
      );
    }

    // Clear stale summary buckets and facts before inserting fresh 7-day summaries
    await c.query(
      `DELETE FROM insight.sales_order_line_facts WHERE tenant_id = $1`,
      [IDS.tenant1],
    );
    await c.query(
      `DELETE FROM insight.sales_order_facts WHERE tenant_id = $1`,
      [IDS.tenant1],
    );
    await c.query(
      `DELETE FROM insight.daily_sales_summaries WHERE tenant_id = $1`,
      [IDS.tenant1],
    );
    await c.query(
      `DELETE FROM insight.product_sales_summaries WHERE tenant_id = $1`,
      [IDS.tenant1],
    );
    await c.query(
      `DELETE FROM insight.channel_sales_summaries WHERE tenant_id = $1`,
      [IDS.tenant1],
    );
    await c.query(
      `DELETE FROM insight.employee_sales_summaries WHERE tenant_id = $1`,
      [IDS.tenant1],
    );
    await c.query(
      `DELETE FROM insight.customer_group_sales_summaries WHERE tenant_id = $1`,
      [IDS.tenant1],
    );

    // 3. Sales Order Facts, Line Facts & Aggregated Summaries
    const dailyMap = new Map<
      string,
      {
        dateBucket: string;
        branchId: string;
        gmv: number;
        grossRev: number;
        discount: number;
        returnsAmt: number;
        netRev: number;
        cogs: number;
        retCogs: number;
        netCogs: number;
        grossProfit: number;
        orderCount: number;
        completedCount: number;
        returnCount: number;
        unitsSold: number;
        unitsReturned: number;
        cashInflow: number;
      }
    >();

    for (const o of orders) {
      const dateStr = vnDateString(o.dayOffset);
      const occurredIso = vnTimestamp(dateStr, o.hourVn, 15);
      const completedIso =
        o.orderStatus === 'COMPLETED'
          ? vnTimestamp(dateStr, o.hourVn, 20)
          : null;
      const isCompleted = o.orderStatus === 'COMPLETED';

      let subtotal = 0;
      let itemDisc = 0;
      let cogsTotal = 0;
      let unitsTotal = 0;
      for (const l of o.lines) {
        const v = ALL_VARIANTS[l.variantIdx];
        subtotal += v.basePrice * l.qty;
        itemDisc += l.discountAmount;
        cogsTotal += v.unitCost * l.qty;
        unitsTotal += l.qty;
      }
      const totalDiscount = itemDisc + o.promotionDiscount;
      const netRev = subtotal - totalDiscount;
      const grandTotal = netRev + o.shippingFee;

      await c.query(
        `INSERT INTO insight.sales_order_facts (
          id, tenant_id, order_id, order_code, branch_id, channel_type,
          customer_id, customer_group_id, seller_staff_id,
          order_status, payment_status, fulfillment_status, date_bucket,
          subtotal, discount_total, tax_total, grand_total, cogs_total, units_total,
          cost_status, contributed_gmv, contributed_gross_revenue, contributed_discount,
          contributed_net_revenue, contributed_cogs, contributed_units_sold,
          contributed_order_count, contributed_completed_count, contributed_cancelled_count,
          last_aggregate_version, occurred_at, completed_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,
          $10,$11,$12,$13,
          $14,$15,0,$16,$17,$18,
          'VERIFIED',$16,$19,$20,
          $21,$22,$23,
          1,$24,0,
          1,$25,$26
        )
        ON CONFLICT (id) DO UPDATE SET
          date_bucket = EXCLUDED.date_bucket,
          occurred_at = EXCLUDED.occurred_at,
          completed_at = EXCLUDED.completed_at,
          grand_total = EXCLUDED.grand_total,
          contributed_gross_revenue = EXCLUDED.contributed_gross_revenue,
          contributed_net_revenue = EXCLUDED.contributed_net_revenue,
          contributed_completed_count = EXCLUDED.contributed_completed_count,
          updated_at = now()`,
        [
          detUuid(`sof:${o.code}`),
          IDS.tenant1,
          o.id,
          o.code,
          o.branchId,
          o.channelType,
          o.customerId,
          o.customerGroupCode,
          o.staffId,
          o.orderStatus,
          o.paymentStatus,
          o.fulfillmentStatus,
          dateStr,
          subtotal,
          totalDiscount,
          grandTotal,
          cogsTotal,
          unitsTotal,
          isCompleted ? subtotal : 0,
          isCompleted ? totalDiscount : 0,
          isCompleted ? netRev : 0,
          isCompleted ? cogsTotal : 0,
          isCompleted ? unitsTotal : 0,
          isCompleted ? 1 : 0,
          occurredIso,
          completedIso,
        ],
      );

      for (const l of o.lines) {
        const v = ALL_VARIANTS[l.variantIdx];
        const lineSub = v.basePrice * l.qty;
        const lineNet = lineSub - l.discountAmount;
        const lineCogs = v.unitCost * l.qty;
        const lineProfit = lineNet - lineCogs;

        await c.query(
          `INSERT INTO insight.sales_order_line_facts (
            id, tenant_id, order_id, line_key, branch_id, channel_type,
            customer_group_id, seller_staff_id, date_bucket,
            variant_id, product_id, sku_code, product_name, category_id, brand_id,
            quantity, unit_price, line_subtotal, line_discount, line_net_revenue,
            unit_cost_snapshot, cogs_amount, gross_profit_amount, cost_status,
            contributed_gross_revenue, contributed_discount, contributed_net_revenue,
            contributed_cogs, contributed_units_sold, occurred_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,
            $10,$11,$12,$13,$14,$15,
            $16,$17,$18,$19,$20,
            $21,$22,$23,'VERIFIED',
            $24,$25,$26,
            $27,$28,$29
          )
          ON CONFLICT (id) DO UPDATE SET
            date_bucket = EXCLUDED.date_bucket,
            occurred_at = EXCLUDED.occurred_at,
            contributed_gross_revenue = EXCLUDED.contributed_gross_revenue,
            contributed_units_sold = EXCLUDED.contributed_units_sold,
            updated_at = now()`,
          [
            detUuid(`solf:${o.code}:${l.id}`),
            IDS.tenant1,
            o.id,
            l.id,
            o.branchId,
            o.channelType,
            o.customerGroupCode,
            o.staffId,
            dateStr,
            v.variantId,
            v.productId,
            v.skuCode,
            v.variantName,
            v.categoryId,
            v.brandId,
            l.qty,
            v.basePrice,
            lineSub,
            l.discountAmount,
            lineNet,
            v.unitCost,
            lineCogs,
            lineProfit,
            isCompleted ? lineSub : 0,
            isCompleted ? l.discountAmount : 0,
            isCompleted ? lineNet : 0,
            isCompleted ? lineCogs : 0,
            isCompleted ? l.qty : 0,
            occurredIso,
          ],
        );

        if (isCompleted) {
          await c.query(
            `INSERT INTO insight.product_sales_summaries (
              id, tenant_id, generation_id, date_bucket, branch_id,
              variant_id, product_id, sku_code, product_name, category_id, brand_id,
              units_sold, units_returned, gross_sales_revenue, discount_total,
              returns_amount, net_sales_revenue, cogs_amount, returned_cogs_amount,
              net_cogs_amount, gross_profit, order_count
            ) VALUES (
              $1,$2,'gen-active',$3,$4,
              $5,$6,$7,$8,$9,$10,
              $11,0,$12,$13,
              0,$14,$15,0,
              $15,$16,1
            )
            ON CONFLICT (id) DO UPDATE SET
              units_sold = insight.product_sales_summaries.units_sold + EXCLUDED.units_sold,
              gross_sales_revenue = insight.product_sales_summaries.gross_sales_revenue + EXCLUDED.gross_sales_revenue,
              net_sales_revenue = insight.product_sales_summaries.net_sales_revenue + EXCLUDED.net_sales_revenue,
              cogs_amount = insight.product_sales_summaries.cogs_amount + EXCLUDED.cogs_amount,
              net_cogs_amount = insight.product_sales_summaries.net_cogs_amount + EXCLUDED.net_cogs_amount,
              gross_profit = insight.product_sales_summaries.gross_profit + EXCLUDED.gross_profit,
              order_count = insight.product_sales_summaries.order_count + 1`,
            [
              detUuid(`pss:${dateStr}:${o.branchId}:${v.variantId}`),
              IDS.tenant1,
              dateStr,
              o.branchId,
              v.variantId,
              v.productId,
              v.skuCode,
              v.variantName,
              v.categoryId,
              v.brandId,
              l.qty,
              lineSub,
              l.discountAmount,
              lineNet,
              lineCogs,
              lineProfit,
            ],
          );
        }
      }

      // Accumulate daily, channel, employee, customer group summaries
      const dKey = `${dateStr}:${o.branchId}`;
      const cur = dailyMap.get(dKey) ?? {
        dateBucket: dateStr,
        branchId: o.branchId,
        gmv: 0,
        grossRev: 0,
        discount: 0,
        returnsAmt: 0,
        netRev: 0,
        cogs: 0,
        retCogs: 0,
        netCogs: 0,
        grossProfit: 0,
        orderCount: 0,
        completedCount: 0,
        returnCount: 0,
        unitsSold: 0,
        unitsReturned: 0,
        cashInflow: 0,
      };
      cur.gmv += grandTotal;
      cur.orderCount += 1;
      if (isCompleted) {
        const retAmt = o.code === 'DH000001' ? 299000 : 0;
        const retCogs = o.code === 'DH000001' ? 165000 : 0;
        cur.grossRev += subtotal;
        cur.discount += totalDiscount;
        cur.returnsAmt += retAmt;
        cur.netRev += netRev - retAmt;
        cur.cogs += cogsTotal;
        cur.retCogs += retCogs;
        cur.netCogs += cogsTotal - retCogs;
        cur.grossProfit += netRev - retAmt - (cogsTotal - retCogs);
        cur.completedCount += 1;
        cur.returnCount += retAmt > 0 ? 1 : 0;
        cur.unitsSold += unitsTotal;
        cur.unitsReturned += retAmt > 0 ? 1 : 0;
        cur.cashInflow += o.paidAmountOverride ?? grandTotal;
      }
      dailyMap.set(dKey, cur);

      if (isCompleted) {
        const grossProfit = netRev - cogsTotal;
        await c.query(
          `INSERT INTO insight.channel_sales_summaries (
            id, tenant_id, generation_id, date_bucket, branch_id, channel_type,
            gmv, gross_sales_revenue, discount_total, returns_amount,
            net_sales_revenue, gross_profit, order_count, completed_order_count, units_sold
          ) VALUES ($1,$2,'gen-active',$3,$4,$5,$6,$7,$8,0,$9,$10,1,1,$11)
          ON CONFLICT (id) DO UPDATE SET
            gmv = insight.channel_sales_summaries.gmv + EXCLUDED.gmv,
            gross_sales_revenue = insight.channel_sales_summaries.gross_sales_revenue + EXCLUDED.gross_sales_revenue,
            net_sales_revenue = insight.channel_sales_summaries.net_sales_revenue + EXCLUDED.net_sales_revenue,
            gross_profit = insight.channel_sales_summaries.gross_profit + EXCLUDED.gross_profit,
            order_count = insight.channel_sales_summaries.order_count + 1,
            completed_order_count = insight.channel_sales_summaries.completed_order_count + 1,
            units_sold = insight.channel_sales_summaries.units_sold + EXCLUDED.units_sold`,
          [
            detUuid(`css:${dateStr}:${o.branchId}:${o.channelType}`),
            IDS.tenant1,
            dateStr,
            o.branchId,
            o.channelType,
            grandTotal,
            subtotal,
            totalDiscount,
            netRev,
            grossProfit,
            unitsTotal,
          ],
        );

        await c.query(
          `INSERT INTO insight.employee_sales_summaries (
            id, tenant_id, generation_id, date_bucket, branch_id, employee_id,
            gross_sales_revenue, discount_total, returns_amount, net_sales_revenue,
            gross_profit, completed_order_count, return_count, units_sold
          ) VALUES ($1,$2,'gen-active',$3,$4,$5,$6,$7,0,$8,$9,1,0,$10)
          ON CONFLICT (id) DO UPDATE SET
            gross_sales_revenue = insight.employee_sales_summaries.gross_sales_revenue + EXCLUDED.gross_sales_revenue,
            net_sales_revenue = insight.employee_sales_summaries.net_sales_revenue + EXCLUDED.net_sales_revenue,
            gross_profit = insight.employee_sales_summaries.gross_profit + EXCLUDED.gross_profit,
            completed_order_count = insight.employee_sales_summaries.completed_order_count + 1,
            units_sold = insight.employee_sales_summaries.units_sold + EXCLUDED.units_sold`,
          [
            detUuid(`ess:${dateStr}:${o.branchId}:${o.staffId}`),
            IDS.tenant1,
            dateStr,
            o.branchId,
            o.staffId,
            subtotal,
            totalDiscount,
            netRev,
            grossProfit,
            unitsTotal,
          ],
        );

        await c.query(
          `INSERT INTO insight.customer_group_sales_summaries (
            id, tenant_id, generation_id, date_bucket, branch_id, customer_group_id,
            gross_sales_revenue, discount_total, returns_amount, net_sales_revenue,
            gross_profit, completed_order_count, units_sold, loyalty_points_earned
          ) VALUES ($1,$2,'gen-active',$3,$4,$5,$6,$7,0,$8,$9,1,$10,$11)
          ON CONFLICT (id) DO UPDATE SET
            gross_sales_revenue = insight.customer_group_sales_summaries.gross_sales_revenue + EXCLUDED.gross_sales_revenue,
            net_sales_revenue = insight.customer_group_sales_summaries.net_sales_revenue + EXCLUDED.net_sales_revenue,
            gross_profit = insight.customer_group_sales_summaries.gross_profit + EXCLUDED.gross_profit,
            completed_order_count = insight.customer_group_sales_summaries.completed_order_count + 1,
            units_sold = insight.customer_group_sales_summaries.units_sold + EXCLUDED.units_sold`,
          [
            detUuid(`cgss:${dateStr}:${o.branchId}:${o.customerGroupCode}`),
            IDS.tenant1,
            dateStr,
            o.branchId,
            o.customerGroupCode,
            subtotal,
            totalDiscount,
            netRev,
            grossProfit,
            unitsTotal,
            Math.floor(netRev / 10000),
          ],
        );
      }
    }

    for (const [key, d] of dailyMap.entries()) {
      await c.query(
        `INSERT INTO insight.daily_sales_summaries (
          id, tenant_id, generation_id, date_bucket, branch_id,
          gmv, gross_sales_revenue, discount_total, returns_amount,
          net_sales_revenue, tax_total, cogs_amount, returned_cogs_amount,
          net_cogs_amount, gross_profit, order_count, completed_order_count,
          cancelled_order_count, return_count, units_sold, units_returned,
          cash_inflow_amount, projection_version
        ) VALUES (
          $1,$2,'gen-active',$3,$4,
          $5,$6,$7,$8,
          $9,0,$10,$11,
          $12,$13,$14,$15,
          0,$16,$17,$18,
          $19,1
        )
        ON CONFLICT (id) DO NOTHING`,
        [
          detUuid(`dss:${key}`),
          IDS.tenant1,
          d.dateBucket,
          d.branchId,
          d.gmv,
          d.grossRev,
          d.discount,
          d.returnsAmt,
          d.netRev,
          d.cogs,
          d.retCogs,
          d.netCogs,
          d.grossProfit,
          d.orderCount,
          d.completedCount,
          d.returnCount,
          d.unitsSold,
          d.unitsReturned,
          d.cashInflow,
        ],
      );
    }

    // 4. Sales Return Facts (TH000001)
    await c.query(
      `INSERT INTO insight.sales_return_facts (
        id, tenant_id, return_id, return_code, order_id, branch_id,
        channel_type, customer_id, customer_group_id, seller_staff_id,
        date_bucket, refund_amount, returned_units, returned_cogs_amount,
        restocked, return_lines, occurred_at
      ) VALUES (
        $1,$2,$3,'TH000001',$4,$5,
        'POS',$6,'vip',$7,
        $8,299000,1,165000,
        true,'[{"skuCode":"POLO-CM-DEN-M","quantity":1,"refundAmount":299000}]'::jsonb,now() - interval '5 days'
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        detUuid('srf:TH000001'),
        IDS.tenant1,
        detUuid('return:t1:TH000001'),
        detUuid('order:t1:DH000001'),
        IDS.branchQ1,
        CUSTOMERS_SEED[0].id,
        IDS.accT1Cashier,
        vnDateString(-5),
      ],
    );

    // 5. Inventory Stock Projections & Value Snapshots
    let q1TotalOnHand = 0;
    let q1TotalValuation = 0;
    for (const v of ALL_VARIANTS) {
      const valQ1 = v.initialQtyQ1 * v.unitCost;
      q1TotalOnHand += v.initialQtyQ1;
      q1TotalValuation += valQ1;

      await c.query(
        `INSERT INTO insight.inventory_stock_projections (
          id, tenant_id, warehouse_id, branch_id, sku_code, variant_id,
          product_name, category_id, on_hand_qty, reserved_qty, available_qty,
          in_transit_qty, avg_unit_cost, inventory_valuation, low_stock_threshold,
          is_low_stock, last_movement_at, last_sale_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,0,$9,
          0,$10,$11,10,
          false,now() - interval '1 day',now()
        )
        ON CONFLICT (id) DO UPDATE SET
          on_hand_qty = EXCLUDED.on_hand_qty,
          available_qty = EXCLUDED.available_qty,
          inventory_valuation = EXCLUDED.inventory_valuation,
          updated_at = now()`,
        [
          detUuid(`ins_stock_proj:Q1:${v.variantId}`),
          IDS.tenant1,
          IDS.whQ1Main,
          IDS.branchQ1,
          v.skuCode,
          v.variantId,
          v.variantName,
          v.categoryId,
          v.initialQtyQ1,
          v.unitCost,
          valQ1,
        ],
      );
    }

    await c.query(
      `INSERT INTO insight.inventory_value_snapshots (
        id, tenant_id, snapshot_date, warehouse_id, branch_id, sku_count,
        total_on_hand_qty, total_reserved_qty, total_available_qty,
        on_hand_valuation, total_valuation
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$7,$8,$8)
      ON CONFLICT (id) DO UPDATE SET
        total_on_hand_qty = EXCLUDED.total_on_hand_qty,
        total_valuation = EXCLUDED.total_valuation,
        updated_at = now()`,
      [
        detUuid(`inv_val_snap:Q1:${today}`),
        IDS.tenant1,
        today,
        IDS.whQ1Main,
        IDS.branchQ1,
        ALL_VARIANTS.length,
        q1TotalOnHand,
        q1TotalValuation,
      ],
    );

    // 6. Notifications & Audit Logs (include unread warning & critical items for Dashboard attention-items)
    const notifs = [
      {
        id: detUuid('notif:t1:1'),
        type: 'order.new_marketplace',
        title: 'Đơn hàng #DH000018 thiếu tồn kho tại Chi nhánh Quận 3',
        body: 'Đơn hàng Shopee #DH000018 cần 2 Thắt lưng da bò Owen nhưng tồn kho CN Quận 3 đã hết. Vui lòng điều chuyển từ Kho Tân Bình.',
        refType: 'order',
        refId: detUuid('order:t1:DH000018'),
        branchId: IDS.branchQ3,
        severity: 'critical',
      },
      {
        id: detUuid('notif:t1:2'),
        type: 'inventory.low_stock',
        title: 'Cảnh báo 3 mã hàng dưới định mức tồn tối thiểu tại CN Quận 3',
        body: 'Đầm Công Sở Nữ Routine Đen Size M (còn 6), Balo Laptop Canvas (còn 5) và Thắt Lưng Da Bò Owen (hết hàng) cần nhập bổ sung.',
        refType: 'warehouse',
        refId: IDS.whQ3Main,
        branchId: IDS.branchQ3,
        severity: 'warning',
      },
      {
        id: detUuid('notif:t1:3'),
        type: 'integration.sku_unmapped',
        title:
          'Phát hiện 1 đơn Lazada (#LZD-8899202699) chưa liên kết SKU nội bộ',
        body: 'Mã ShopSKU SM-LINEN-BE-XL trên Lazada Flagship chưa được ánh xạ với biến thể Catalog. Vui lòng xử lý tại mục Xung đột đồng bộ.',
        refType: 'sync_conflict',
        refId: detUuid('sync_conflict:t1:lazada:1'),
        branchId: IDS.branchQ1,
        severity: 'warning',
      },
      {
        id: detUuid('notif:t1:4'),
        type: 'finance.cod_reconciled',
        title: 'Hoàn tất đối soát COD kỳ 11/2026 - Giao Hàng Nhanh',
        body: 'Lô đối soát #COD000001 đã khớp 100% và ghi nhận 1.138.000đ vào tài khoản Vietcombank.',
        refType: 'cod_batch',
        refId: detUuid('cod_batch:t1:COD000001'),
        branchId: IDS.branchQ1,
        severity: 'info',
      },
      {
        id: detUuid('notif:t1:5'),
        type: 'inventory.stock_take_approved',
        title: 'Đã duyệt phiếu kiểm kho #KK000001 tại Chi nhánh Quận 1',
        body: 'Phiếu kiểm kê định kỳ KK000001 đã được Quản lý Lê Thị Thanh Hương phê duyệt hoàn tất.',
        refType: 'stock_take',
        refId: detUuid('stock_take:t1:KK000001'),
        branchId: IDS.branchQ1,
        severity: 'info',
      },
    ];

    for (const n of notifs) {
      await c.query(
        `INSERT INTO insight.notification (
          id, tenant_id, type, title, body, ref_type, ref_id, branch_id, severity
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO UPDATE SET
          type = EXCLUDED.type,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          ref_type = EXCLUDED.ref_type,
          ref_id = EXCLUDED.ref_id,
          branch_id = EXCLUDED.branch_id,
          severity = EXCLUDED.severity,
          created_at = now()`,
        [
          n.id,
          IDS.tenant1,
          n.type,
          n.title,
          n.body,
          n.refType,
          n.refId,
          n.branchId,
          n.severity,
        ],
      );
    }

    await c.query(
      `DELETE FROM insight.notification_read WHERE notification_id IN ($1,$2,$3)`,
      [notifs[0].id, notifs[1].id, notifs[2].id],
    );
    await c.query(
      `INSERT INTO insight.notification_read (notification_id, account_id)
       VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [notifs[4].id, IDS.accT1Owner],
    );

    await c.query(
      `INSERT INTO insight.audit_log (
        id, tenant_id, type, actor_id, summary, data, occurred_at
      ) VALUES
        ($1,$2,'pos.shift.closed',$3,'Đóng ca thu ngân CA000001 tại Quầy Q01 - Khớp quỹ tiền mặt 3.887.000đ','{"shiftCode":"CA000001","variance":0}'::jsonb,now() - interval '1 day'),
        ($4,$2,'finance.cod.reconciled',$5,'Đối soát thành công lô COD000001 (Giao Hàng Nhanh)','{"batchCode":"COD000001","netPayout":1138000}'::jsonb,now() - interval '12 hours'),
        ($6,$2,'sales.order.completed',$7,'Hoàn tất đơn hàng POS #DH000007 (1.538.000đ - QR Vietcombank)','{"orderCode":"DH000007","grandTotal":1538000}'::jsonb,now() - interval '1 hour')
      ON CONFLICT (id) DO UPDATE SET occurred_at = EXCLUDED.occurred_at`,
      [
        detUuid('audit:t1:1'),
        IDS.tenant1,
        IDS.accT1Manager,
        detUuid('audit:t1:2'),
        IDS.accT1Accountant,
        detUuid('audit:t1:3'),
        IDS.accT1Cashier,
      ],
    );
  });
}
