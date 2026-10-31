import { PermissionModule } from '@pbl/contracts';

/** Display names of the permission modules (Vietnamese, as in the Figma matrix). */
export const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: 'Tổng quan',
  products: 'Sản phẩm',
  inventory: 'Tồn kho / Phiếu kho',
  orders: 'Đơn hàng',
  pos: 'Bán tại quầy',
  channels: 'Kênh bán hàng',
  customers: 'Khách hàng',
  purchasing: 'Nhập hàng',
  staff: 'Nhân viên',
  reports: 'Báo cáo',
  finance: 'Tài chính',
  settings: 'Cài đặt',
};
