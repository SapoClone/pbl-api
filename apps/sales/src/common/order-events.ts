import type { OrderCompletedPayload } from '@pbl/contracts';
import { channelTypeOf } from './order-views';

interface CostLine {
  qty?: string | number | null;
  quantity?: number | null;
  unitCostSnapshot?: number | null;
}

/**
 * What the goods of an order cost, from the cost snapshots of its lines
 * (qty x unit cost, rounded half up per line). `undefined` when no line carries
 * a cost, so the event omits it and insight shows the margin as unknown.
 */
export function costAmountOf(lines: readonly CostLine[]): number | undefined {
  let total = 0;
  let any = false;
  for (const line of lines) {
    const unit = Number(line.unitCostSnapshot ?? 0);
    if (!Number.isFinite(unit) || unit <= 0) continue;
    any = true;
    const qty = Number(line.qty ?? line.quantity ?? 0);
    total += Math.round(qty * unit);
  }
  return any ? total : undefined;
}

/** `channel` and `costAmount` of `sales.order.completed`, spread into the payload */
export function completedEventExtras(
  order: { channelType?: string | null; channelId?: string | null },
  lines: readonly CostLine[],
  channelRowType?: string | null,
): Pick<OrderCompletedPayload, 'channel' | 'channelId' | 'costAmount'> {
  const cost = costAmountOf(lines);
  return {
    channel: channelTypeOf(order.channelType, channelRowType),
    ...(order.channelId ? { channelId: order.channelId } : {}),
    ...(cost !== undefined ? { costAmount: cost } : {}),
  };
}
