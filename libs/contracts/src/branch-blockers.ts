/**
 * The branch-guard contract (workstream B, decisions D4 and D5): what each service
 * answers to `GET /internal/v1/branches/{branchId}/blockers` (and sales to
 * `GET /internal/v1/members/{accountId}/blockers`). Platform asks every service
 * before it deactivates or deletes a branch (or removes a member) and refuses with
 * every reason it got. Internal routes: not in krakend, guarded by `x-internal-token`.
 */

/** One reason a branch (or a member) cannot be deactivated, deleted or removed */
export interface BranchBlocker {
  /** Stable machine code, `<SERVICE>_<WHAT>` (e.g. `INVENTORY_STOCK_ON_HAND`) */
  code: string;
  /** Plain Vietnamese text with the number, ready for the screen */
  message: string;
  /** How many items block (rows, documents, connections) */
  count: number;
  /** A few ids or codes of the blocking items, to find them */
  samples?: string[];
}

export interface BranchBlockersResponse {
  reasons: BranchBlocker[];
}

/** At most this many `samples` per reason */
export const BLOCKERS_SAMPLE_LIMIT = 5;
