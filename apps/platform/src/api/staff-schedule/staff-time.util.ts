/** Store timezone until tenants have one (api-conventions §5). */
export const STORE_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** 'HH:MM:SS' or 'HH:MM' to 'HH:MM' */
export const toHm = (time: string): string => time.slice(0, 5);

/** Minutes since midnight of an 'HH:MM[:SS]' string */
export const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/** ISO weekday (1 = Monday) and minutes since midnight in the store's timezone. */
export const storeNow = (
  now: Date = new Date(),
): { weekday: number; minutes: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    weekday: weekdays.indexOf(get('weekday')) + 1,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
};
