import { registerAs } from '@nestjs/config';

/**
 * Where platform asks the other services whether a branch (or a member) can be
 * deactivated, deleted or removed (D4, D5; docs/guides/branch-guard.md). The
 * defaults are the local compose hostnames; deployments set the variables.
 */
export interface BranchGuardConfig {
  inventoryUrl: string;
  salesUrl: string;
  integrationUrl: string;
  /** The shared service token sent as `x-internal-token` */
  internalToken: string;
  timeoutMs: number;
}

const strip = (url: string) => url.replace(/\/+$/, '');

export default registerAs(
  'branchGuard',
  (): BranchGuardConfig => ({
    inventoryUrl: strip(
      process.env.INVENTORY_SERVICE_URL || 'http://inventory:3000',
    ),
    salesUrl: strip(process.env.SALES_SERVICE_URL || 'http://sales:3000'),
    integrationUrl: strip(
      process.env.INTEGRATION_SERVICE_URL || 'http://integration:3000',
    ),
    internalToken: process.env.INTERNAL_S2S_TOKEN ?? '',
    timeoutMs: Number(process.env.BRANCH_GUARD_TIMEOUT_MS) || 3000,
  }),
);
