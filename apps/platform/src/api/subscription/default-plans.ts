/** The plans of the platform admin design (its open question 1 until the team decides prices and limits). */
export const DEFAULT_PLANS = [
  {
    code: 'free',
    name: 'Free',
    description: 'Cho cửa hàng mới bắt đầu',
    priceMonthly: 0,
    isFeatured: false,
    quotaBranches: 1,
    quotaUsers: 3,
    quotaProducts: 100,
    quotaStorageMb: 1024,
  },
  {
    code: 'basic',
    name: 'Basic',
    description: 'Cho cửa hàng nhỏ',
    priceMonthly: 299000,
    isFeatured: false,
    quotaBranches: 2,
    quotaUsers: 10,
    quotaProducts: 2000,
    quotaStorageMb: 10240,
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'Dành cho chuỗi cửa hàng',
    priceMonthly: 599000,
    isFeatured: true,
    quotaBranches: 5,
    quotaUsers: 30,
    quotaProducts: 10000,
    quotaStorageMb: 51200,
  },
] as const;

export const FREE_PLAN_CODE = 'free';
