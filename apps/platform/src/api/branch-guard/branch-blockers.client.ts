import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InternalHttpClient } from '@pbl/common';
import { BranchBlocker, BranchBlockersResponse } from '@pbl/contracts';
import branchGuardConfig from './branch-guard.config';

/** A reason as platform reports it: the service it came from is named */
export interface ServiceBlocker extends BranchBlocker {
  service: string;
}

/** A service that owns branch data could not be asked (or answered nonsense): the caller fails closed */
export class BlockersUnavailableError extends Error {
  constructor(
    public readonly service: string,
    cause?: unknown,
  ) {
    super(
      `Branch guard: ${service} could not be asked${cause instanceof Error ? ` (${cause.message})` : ''}`,
    );
    this.name = 'BlockersUnavailableError';
  }
}

/**
 * Synchronous cross-service read behind the branch guard (docs/guides/branch-guard.md):
 * asks every service that owns branch-bound data, in parallel, and returns every
 * reason of every service. Any service that does not answer 200 with a valid body
 * makes the whole call throw BlockersUnavailableError (fail closed).
 */
@Injectable()
export class BranchBlockersClient {
  private readonly logger = new Logger(BranchBlockersClient.name);

  constructor(
    private readonly http: InternalHttpClient,
    @Inject(branchGuardConfig.KEY)
    private readonly config: ConfigType<typeof branchGuardConfig>,
  ) {}

  forBranch(tenantId: string, branchId: string): Promise<ServiceBlocker[]> {
    const path = `/internal/v1/branches/${branchId}/blockers`;
    return this.askAll(tenantId, [
      ['inventory', this.config.inventoryUrl + path],
      ['sales', this.config.salesUrl + path],
      ['integration', this.config.integrationUrl + path],
    ]);
  }

  /** D5: only sales knows POS shifts */
  forMember(tenantId: string, accountId: string): Promise<ServiceBlocker[]> {
    return this.askAll(tenantId, [
      [
        'sales',
        `${this.config.salesUrl}/internal/v1/members/${accountId}/blockers`,
      ],
    ]);
  }

  private async askAll(
    tenantId: string,
    targets: Array<[service: string, url: string]>,
  ): Promise<ServiceBlocker[]> {
    const answers = await Promise.all(
      targets.map(([service, url]) => this.ask(tenantId, service, url)),
    );
    return answers.flat();
  }

  private async ask(
    tenantId: string,
    service: string,
    url: string,
  ): Promise<ServiceBlocker[]> {
    let body: BranchBlockersResponse;
    try {
      const response = await this.http.get<BranchBlockersResponse>(
        url,
        {
          timeout: this.config.timeoutMs,
          headers: { 'x-internal-token': this.config.internalToken },
        },
        { asService: true, tenantId },
      );
      body = response.data;
    } catch (error) {
      this.logger.warn(
        `${service} blockers call failed: ${error instanceof Error ? error.message : error}`,
      );
      throw new BlockersUnavailableError(service, error);
    }
    if (!body || !Array.isArray(body.reasons)) {
      throw new BlockersUnavailableError(service);
    }
    return body.reasons.map((reason) => ({ ...reason, service }));
  }
}
