import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import {
  INTEGRATION_CONNECTION_CONNECTED,
  INTEGRATION_CONNECTION_DISCONNECTED,
  INTEGRATION_CONNECTION_REAUTH_REQUIRED,
  IntegrationConnectionEventPayload,
} from '@pbl/contracts';
import { EventOutbox, qualifiedTable } from '@pbl/events';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { readLazadaConfig } from '../../config/integration.config';
import {
  ConnectionStatus,
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  MarketplaceProvider,
  assertValidConnectionTransition,
  createOAuthStateToken,
  decryptCredentialSecret,
  encryptCredentialSecret,
  verifyOAuthStateToken,
} from '../../domain/integration-domain';
import { nextIntegrationCode } from '../../infrastructure/persistence/integration-code.generator';
import {
  ChannelConnectionEntity,
  ConnectionCredentialEntity,
  IntegrationAuditLogEntity,
} from '../../infrastructure/persistence/integration.entities';
import { ProviderRateLimiterService } from '../../infrastructure/rate-limiting/provider-rate-limiter.service';
import type { TokenExchangeResult } from '../../providers/contracts/provider.contracts';
import { ProviderRegistryService } from '../../providers/provider-registry.service';
import {
  AuthorizeChannelConnectionDto,
  CreateChannelConnectionDto,
  LazadaOAuthCallbackQueryDto,
  RefreshConnectionTokenDto,
} from './connections.dto';

export interface SanitizedChannelConnectionView {
  id: string;
  tenantId: string;
  code: string;
  provider: MarketplaceProvider;
  connectionKey: string;
  externalShopId: string;
  shopName: string;
  branchId: string;
  warehouseId: string | null;
  status: ConnectionStatus;
  safetyStockBuffer: number;
  stockAllocationPercent: number;
  lastSyncAt: string | null;
  lastOrderSyncAt: string | null;
  lastInventorySyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  credentialSummary: {
    credentialVersion: number;
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    accessTokenExpiresAt: string | null;
    refreshTokenExpiresAt: string | null;
    lastRefreshedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface DecryptedConnectionCredentials {
  connection: ChannelConnectionEntity;
  credentialVersion: number;
  accessToken: string;
  refreshToken: string | null;
  webhookSecret: string;
  partnerId: string | null;
}

export interface LazadaPublicCallbackResult {
  mode: 'OAUTH_COMPLETED';
  provider: 'LAZADA';
  status: 'CONNECTED';
  tenantId: string;
  connectionId: string;
  externalShopId: string;
  shopName: string;
  redirectUrl: string | null;
  connection: SanitizedChannelConnectionView;
}

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly rateLimiter: ProviderRateLimiterService,
    private readonly outbox: EventOutbox,
  ) {}

  async createConnection(
    actorId: string,
    dto: CreateChannelConnectionDto,
  ): Promise<SanitizedChannelConnectionView> {
    const tenantId = TenantContext.require();
    if (
      dto.provider === 'SHOPEE' &&
      (!dto.externalShopId?.trim() ||
        !dto.shopName?.trim() ||
        !dto.webhookSecret?.trim())
    ) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.VALIDATION_ERROR,
        'externalShopId, shopName, and webhookSecret are required for SHOPEE connections',
        400,
      );
    }

    const initialStatus: ConnectionStatus = dto.accessToken
      ? 'CONNECTED'
      : 'PENDING_AUTH';
    const connId = randomUUID();
    const resolvedExternalShopId =
      dto.externalShopId?.trim() || `pending_lazada_${connId}`;
    const resolvedShopName = dto.shopName?.trim() || 'Pending Lazada Seller';

    try {
      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);

        const code = await nextIntegrationCode(em, tenantId, 'CON');
        const connectionKey = `ck_${dto.provider.toLowerCase()}_${randomBytes(12).toString('hex')}`;
        const now = new Date();

        const conn = em.create(ChannelConnectionEntity, {
          id: connId,
          tenantId,
          code,
          provider: dto.provider,
          connectionKey,
          externalShopId: resolvedExternalShopId,
          shopName: resolvedShopName,
          branchId: dto.branchId,
          warehouseId: dto.warehouseId ?? null,
          status: initialStatus,
          safetyStockBuffer: dto.safetyStockBuffer ?? 0,
          stockAllocationPercent: dto.stockAllocationPercent ?? 100,
          oauthStateNonce: null,
          oauthRedirectUri: null,
          oauthInitiatedBy: null,
          lastSyncAt: initialStatus === 'CONNECTED' ? now : null,
          lastOrderSyncAt: null,
          lastInventorySyncAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          consecutiveFailures: 0,
          version: 1,
          createdBy: actorId,
        });
        await em.save(ChannelConnectionEntity, conn);

        const resolvedPartnerId =
          dto.partnerId?.trim() ||
          (dto.provider === 'LAZADA'
            ? process.env.LAZADA_APP_KEY?.trim()
            : undefined) ||
          `${dto.provider.toLowerCase()}-partner`;
        const resolvedWebhookSecret =
          dto.webhookSecret && dto.webhookSecret.trim() !== 'configured-via-env'
            ? dto.webhookSecret.trim()
            : dto.provider === 'LAZADA' && process.env.LAZADA_APP_SECRET?.trim()
              ? process.env.LAZADA_APP_SECRET.trim()
              : dto.webhookSecret?.trim() || 'configured-via-env';

        const cred = em.create(ConnectionCredentialEntity, {
          id: randomUUID(),
          tenantId,
          connectionId: conn.id,
          credentialVersion: 1,
          encryptedAccessToken: dto.accessToken
            ? encryptCredentialSecret(dto.accessToken)
            : null,
          encryptedRefreshToken: dto.refreshToken
            ? encryptCredentialSecret(dto.refreshToken)
            : null,
          encryptedWebhookSecret: encryptCredentialSecret(
            resolvedWebhookSecret,
          ),
          partnerId: resolvedPartnerId,
          keyVersion: 1,
          accessTokenExpiresAt: dto.accessToken
            ? new Date(now.getTime() + 4 * 3600 * 1000)
            : null,
          refreshTokenExpiresAt: dto.refreshToken
            ? new Date(now.getTime() + 30 * 24 * 3600 * 1000)
            : null,
          scopes: 'order.read,product.stock.write,product.read',
          refreshLeaseOwner: null,
          refreshLeaseExpiresAt: null,
          lastRefreshedAt: dto.accessToken ? now : null,
        });
        await em.save(ConnectionCredentialEntity, cred);

        await em.save(
          IntegrationAuditLogEntity,
          em.create(IntegrationAuditLogEntity, {
            tenantId,
            connectionId: conn.id,
            actorId,
            action: 'CONNECTION_CREATED',
            targetType: 'CHANNEL_CONNECTION',
            targetId: conn.id,
            metadata: {
              provider: conn.provider,
              externalShopId: conn.externalShopId,
              status: conn.status,
            },
          }),
        );

        if (initialStatus === 'CONNECTED') {
          await this.outbox.enqueue(em, INTEGRATION_CONNECTION_CONNECTED, {
            tenantId,
            aggregateId: conn.id,
            actor: { id: actorId, type: 'account' },
            payload: {
              connectionId: conn.id,
              provider: conn.provider,
              externalShopId: conn.externalShopId,
              shopName: conn.shopName,
              branchId: conn.branchId,
              warehouseId: conn.warehouseId,
              status: conn.status,
              occurredAt: now.toISOString(),
            } satisfies IntegrationConnectionEventPayload,
          });
        }

        return this.toSanitizedView(conn, cred);
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        String((err as any).code) === '23505'
      ) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_CONFLICT,
          `Shop ${resolvedExternalShopId} on ${dto.provider} is already connected`,
          409,
        );
      }
      throw err;
    }
  }

  async listConnections(): Promise<SanitizedChannelConnectionView[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conns = await em.getRepository(ChannelConnectionEntity).find({
        where: { tenantId },
        order: { createdAt: 'DESC' },
      });
      const creds = await em.getRepository(ConnectionCredentialEntity).find({
        where: { tenantId },
      });
      const credByConn = new Map(creds.map((c) => [c.connectionId, c]));
      return conns.map((c) => this.toSanitizedView(c, credByConn.get(c.id)));
    });
  }

  async getConnectionById(
    connectionId: string,
    tenantId: string = TenantContext.require(),
  ): Promise<SanitizedChannelConnectionView> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: connectionId, tenantId },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Channel connection ${connectionId} not found`,
          404,
        );
      }
      const cred = await em.getRepository(ConnectionCredentialEntity).findOne({
        where: { connectionId, tenantId },
      });
      return this.toSanitizedView(conn, cred ?? undefined);
    });
  }

  async authorizeConnection(
    connectionId: string,
    actorId: string,
    dto: AuthorizeChannelConnectionDto,
  ) {
    const tenantId = TenantContext.require();

    // Mode 1: Initiate OAuth redirect flow in a short transaction
    if (!dto.authorizationCode) {
      return this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const conn = await em.getRepository(ChannelConnectionEntity).findOne({
          where: { id: connectionId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!conn) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
            `Channel connection ${connectionId} not found`,
            404,
          );
        }
        const cred = await em
          .getRepository(ConnectionCredentialEntity)
          .findOne({
            where: { connectionId, tenantId },
            lock: { mode: 'pessimistic_write' },
          });
        if (!cred) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
            `Credentials record missing for connection ${connectionId}`,
            500,
          );
        }

        const adapter = this.providerRegistry.getAdapter(conn.provider);
        const partnerSecret = decryptCredentialSecret(
          cred.encryptedWebhookSecret,
        );
        const partnerId =
          cred.partnerId ?? `${conn.provider.toLowerCase()}-partner`;

        if (conn.provider === 'LAZADA') {
          const lazadaConfig = readLazadaConfig();
          const serverCallbackUrl = lazadaConfig.callbackUrl;
          if (
            dto.redirectUri &&
            dto.redirectUri.trim().replace(/\/+$/, '') !== serverCallbackUrl
          ) {
            throw new IntegrationDomainError(
              IntegrationDomainErrorCode.VALIDATION_ERROR,
              `Lazada redirectUri cannot be overridden by client; must match server-configured LAZADA_CALLBACK_URL (${serverCallbackUrl})`,
              400,
              { configuredCallbackUrl: serverCallbackUrl },
            );
          }

          const signedState = createOAuthStateToken({
            tenantId,
            connectionId: conn.id,
            actorId,
          });
          conn.oauthStateNonce = signedState.stateHash;
          conn.oauthRedirectUri = serverCallbackUrl;
          conn.oauthInitiatedBy = actorId;
          await em.save(ChannelConnectionEntity, conn);

          const authUrl = adapter.buildAuthorizationUrl({
            connectionId: conn.id,
            externalShopId: conn.externalShopId,
            redirectUri: serverCallbackUrl,
            stateNonce: signedState.stateToken,
            partnerId,
            partnerSecret,
          });
          return {
            mode: 'OAUTH_INITIATED' as const,
            connectionId: conn.id,
            provider: conn.provider,
            ...authUrl,
          };
        }

        const stateNonce = `st_${conn.id.slice(0, 8)}_${randomBytes(12).toString('hex')}`;
        const redirectUri =
          dto.redirectUri ??
          `https://app.sapoclone.local/integrations/${conn.provider.toLowerCase()}/callback`;
        conn.oauthStateNonce = stateNonce;
        conn.oauthRedirectUri = redirectUri;
        conn.oauthInitiatedBy = actorId;
        await em.save(ChannelConnectionEntity, conn);

        const authUrl = adapter.buildAuthorizationUrl({
          connectionId: conn.id,
          externalShopId: conn.externalShopId,
          redirectUri,
          stateNonce,
          partnerId,
          partnerSecret,
        });
        return {
          mode: 'OAUTH_INITIATED' as const,
          connectionId: conn.id,
          provider: conn.provider,
          ...authUrl,
        };
      });
    }

    // Mode 2: Complete OAuth callback using 2 short transactions (never hold DB lock during provider HTTP call)
    const claim = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: connectionId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Channel connection ${connectionId} not found`,
          404,
        );
      }
      const cred = await em.getRepository(ConnectionCredentialEntity).findOne({
        where: { connectionId, tenantId },
      });
      if (!cred) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
          `Credentials record missing for connection ${connectionId}`,
          500,
        );
      }

      if (conn.oauthStateNonce) {
        if (conn.oauthStateNonce.startsWith('sha256:')) {
          const verified = verifyOAuthStateToken({
            stateToken: dto.stateNonce,
          });
          if (
            verified.payload.tenantId !== tenantId ||
            verified.payload.connectionId !== conn.id ||
            verified.stateHash !== conn.oauthStateNonce
          ) {
            throw new IntegrationDomainError(
              IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
              'OAuth callback state nonce mismatch (CSRF protection rejected callback)',
              401,
            );
          }
        } else if (dto.stateNonce !== conn.oauthStateNonce) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
            'OAuth callback state nonce mismatch (CSRF protection rejected callback)',
            401,
          );
        }
      }

      if (
        dto.externalShopId &&
        !conn.externalShopId.startsWith('pending_') &&
        dto.externalShopId.trim() !== conn.externalShopId
      ) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
          `Returned shop identity (${dto.externalShopId}) does not match connection shop (${conn.externalShopId})`,
          409,
        );
      }

      assertValidConnectionTransition(conn.status, 'CONNECTED');

      // Atomically consume oauthStateNonce in Transaction 1
      conn.oauthStateNonce = null;
      await em.save(ChannelConnectionEntity, conn);

      return {
        provider: conn.provider,
        externalShopId: conn.externalShopId,
        partnerId: cred.partnerId ?? `${conn.provider.toLowerCase()}-partner`,
        partnerSecret: decryptCredentialSecret(cred.encryptedWebhookSecret),
      };
    });

    const adapter = this.providerRegistry.getAdapter(claim.provider);
    let exchanged: TokenExchangeResult;
    try {
      exchanged = await adapter.exchangeAuthorizationCode({
        connectionId,
        code: dto.authorizationCode,
        externalShopId: claim.externalShopId,
        partnerId: claim.partnerId,
        partnerSecret: claim.partnerSecret,
      });
    } catch (err) {
      await this.recordAuthorizationFailure(tenantId, connectionId, err);
      throw err;
    }

    const updatedView = await this.finalizeAuthorizedConnection({
      tenantId,
      connectionId,
      actorId,
      exchanged,
    });

    return {
      mode: 'OAUTH_COMPLETED' as const,
      connection: updatedView,
    };
  }

  /**
   * Public Lazada OAuth callback handler (`GET /api/v1/integrations/lazada/callback`).
   * Does not rely on Platform JWT; recovers `tenantId` and `connectionId` exclusively
   * from the HMAC-SHA256 verified `state` token and uses 2 short PostgreSQL transactions
   * around the external Lazada `/auth/token/create` API call.
   */
  async handleLazadaPublicCallback(
    query: LazadaOAuthCallbackQueryDto,
  ): Promise<LazadaPublicCallbackResult> {
    if (query.error) {
      const errorDesc = query.error_description
        ? `${query.error}: ${query.error_description}`
        : query.error;
      if (query.state) {
        try {
          const verified = verifyOAuthStateToken({
            stateToken: query.state,
          });
          await this.recordAuthorizationFailure(
            verified.payload.tenantId,
            verified.payload.connectionId,
            new IntegrationDomainError(
              IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
              `Lazada seller denied or failed authorization (${errorDesc})`,
              400,
            ),
            true,
          );
        } catch {
          // Ignore state verification error when reporting provider error
        }
      }
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        `Lazada OAuth callback returned provider error: ${errorDesc}`,
        400,
        { providerError: query.error },
      );
    }

    // 1. Verify HMAC-SHA256 signed state token before touching DB
    const { payload, stateHash } = verifyOAuthStateToken({
      stateToken: query.state,
    });

    const code = query.code?.trim() ?? '';
    if (!code) {
      throw new IntegrationDomainError(
        IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
        'Lazada OAuth callback is missing authorization code',
        400,
      );
    }

    // 2. Short Transaction 1: Lock connection, verify & atomically consume oauthStateNonce
    const claim = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        payload.tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: payload.connectionId, tenantId: payload.tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Channel connection ${payload.connectionId} not found`,
          404,
        );
      }
      if (conn.provider !== 'LAZADA') {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
          `Connection ${conn.id} is not a LAZADA connection`,
          400,
        );
      }
      if (!conn.oauthStateNonce) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.OAUTH_STATE_REPLAYED,
          'OAuth state token has already been used or no authorization is pending',
          409,
        );
      }
      if (conn.oauthStateNonce !== stateHash) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.OAUTH_STATE_INVALID,
          'OAuth state token does not match the active authorization attempt for this connection',
          401,
        );
      }

      assertValidConnectionTransition(conn.status, 'CONNECTED');

      const cred = await em.getRepository(ConnectionCredentialEntity).findOne({
        where: { connectionId: conn.id, tenantId: payload.tenantId },
      });
      if (!cred) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
          `Credentials record missing for connection ${conn.id}`,
          500,
        );
      }

      // Consume state nonce immediately so parallel/replay callbacks are rejected
      conn.oauthStateNonce = null;
      await em.save(ChannelConnectionEntity, conn);

      return {
        externalShopId: conn.externalShopId,
        partnerId: cred.partnerId ?? 'lazada-partner',
        partnerSecret: decryptCredentialSecret(cred.encryptedWebhookSecret),
      };
    });

    // 3. Outside DB Transaction: Exchange authorization code with Lazada Open Platform
    const adapter = this.providerRegistry.getAdapter('LAZADA');
    let exchanged: TokenExchangeResult;
    try {
      exchanged = await adapter.exchangeAuthorizationCode({
        connectionId: payload.connectionId,
        code,
        externalShopId: claim.externalShopId,
        partnerId: claim.partnerId,
        partnerSecret: claim.partnerSecret,
      });
    } catch (err) {
      await this.recordAuthorizationFailure(
        payload.tenantId,
        payload.connectionId,
        err,
      );
      throw err;
    }

    // 4. Short Transaction 2: Validate seller identity & market, bind shop ID, encrypt tokens, mark CONNECTED
    const connectionView = await this.finalizeAuthorizedConnection({
      tenantId: payload.tenantId,
      connectionId: payload.connectionId,
      actorId: payload.actorId,
      exchanged,
    });

    const lazadaConfig = readLazadaConfig();
    let redirectUrl: string | null = null;
    if (lazadaConfig.frontendRedirectUrl) {
      const target = new URL(lazadaConfig.frontendRedirectUrl);
      target.searchParams.set('provider', 'lazada');
      target.searchParams.set('status', 'connected');
      target.searchParams.set('connectionId', connectionView.id);
      target.searchParams.set('externalShopId', connectionView.externalShopId);
      redirectUrl = target.toString();
    }

    return {
      mode: 'OAUTH_COMPLETED',
      provider: 'LAZADA',
      status: 'CONNECTED',
      tenantId: payload.tenantId,
      connectionId: connectionView.id,
      externalShopId: connectionView.externalShopId,
      shopName: connectionView.shopName,
      redirectUrl,
      connection: connectionView,
    };
  }

  private async finalizeAuthorizedConnection(params: {
    tenantId: string;
    connectionId: string;
    actorId: string;
    exchanged: TokenExchangeResult;
  }): Promise<SanitizedChannelConnectionView> {
    const { tenantId, connectionId, actorId, exchanged } = params;
    try {
      return await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const conn = await em.getRepository(ChannelConnectionEntity).findOne({
          where: { id: connectionId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!conn) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
            `Channel connection ${connectionId} not found`,
            404,
          );
        }
        const cred = await em
          .getRepository(ConnectionCredentialEntity)
          .findOne({
            where: { connectionId, tenantId },
            lock: { mode: 'pessimistic_write' },
          });
        if (!cred) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
            `Credentials record missing for connection ${connectionId}`,
            500,
          );
        }

        if (conn.provider === 'LAZADA' && exchanged.country) {
          const expectedRegion = readLazadaConfig().region.toUpperCase();
          const actualCountry = exchanged.country.trim().toUpperCase();
          if (actualCountry && actualCountry !== expectedRegion) {
            throw new IntegrationDomainError(
              IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
              `Lazada seller country (${actualCountry}) does not match configured region (${expectedRegion})`,
              422,
              { expectedRegion, actualCountry },
            );
          }
        }

        const wasPendingShop = conn.externalShopId.startsWith('pending_');
        if (
          !wasPendingShop &&
          exchanged.externalShopId &&
          exchanged.externalShopId !== conn.externalShopId
        ) {
          throw new IntegrationDomainError(
            IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
            `Authorized seller shop ID (${exchanged.externalShopId}) does not match connection externalShopId (${conn.externalShopId})`,
            409,
          );
        }

        assertValidConnectionTransition(conn.status, 'CONNECTED');

        if (exchanged.externalShopId) {
          conn.externalShopId = exchanged.externalShopId;
        }
        if (
          (wasPendingShop || conn.shopName === 'Pending Lazada Seller') &&
          exchanged.shopName
        ) {
          conn.shopName = exchanged.shopName;
        }

        const now = new Date();
        cred.encryptedAccessToken = encryptCredentialSecret(
          exchanged.accessToken,
        );
        cred.encryptedRefreshToken = encryptCredentialSecret(
          exchanged.refreshToken,
        );
        cred.accessTokenExpiresAt = exchanged.accessTokenExpiresAt;
        cred.refreshTokenExpiresAt = exchanged.refreshTokenExpiresAt;
        cred.scopes = exchanged.scopes.join(',');
        cred.credentialVersion += 1;
        cred.lastRefreshedAt = now;
        await em.save(ConnectionCredentialEntity, cred);

        conn.status = 'CONNECTED';
        conn.oauthStateNonce = null;
        conn.lastSyncAt = now;
        conn.lastErrorCode = null;
        conn.lastErrorMessage = null;
        conn.consecutiveFailures = 0;
        conn.version += 1;
        await em.save(ChannelConnectionEntity, conn);

        await em.save(
          IntegrationAuditLogEntity,
          em.create(IntegrationAuditLogEntity, {
            tenantId,
            connectionId: conn.id,
            actorId,
            action: 'CONNECTION_AUTHORIZED',
            targetType: 'CHANNEL_CONNECTION',
            targetId: conn.id,
            metadata: {
              provider: conn.provider,
              externalShopId: conn.externalShopId,
              credentialVersion: cred.credentialVersion,
              country: exchanged.country ?? null,
              shortCode: exchanged.shortCode ?? null,
              liveMode: exchanged.liveMode,
            },
          }),
        );

        await this.outbox.enqueue(em, INTEGRATION_CONNECTION_CONNECTED, {
          tenantId,
          aggregateId: conn.id,
          actor: { id: actorId, type: 'account' },
          payload: {
            connectionId: conn.id,
            provider: conn.provider,
            externalShopId: conn.externalShopId,
            shopName: conn.shopName,
            branchId: conn.branchId,
            warehouseId: conn.warehouseId,
            status: conn.status,
            occurredAt: now.toISOString(),
          } satisfies IntegrationConnectionEventPayload,
        });

        return this.toSanitizedView(conn, cred);
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        String((err as any).code) === '23505'
      ) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_CONFLICT,
          `Shop ${exchanged.externalShopId} on LAZADA is already connected to another channel connection`,
          409,
        );
      }
      throw err;
    }
  }

  private async recordAuthorizationFailure(
    tenantId: string,
    connectionId: string,
    error: unknown,
    clearStateNonce = false,
  ): Promise<void> {
    try {
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const conn = await em.getRepository(ChannelConnectionEntity).findOne({
          where: { id: connectionId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!conn) return;
        conn.lastErrorCode =
          error instanceof IntegrationDomainError
            ? error.code
            : IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED;
        conn.lastErrorMessage =
          error instanceof Error ? error.message.slice(0, 500) : String(error);
        conn.consecutiveFailures += 1;
        if (clearStateNonce) {
          conn.oauthStateNonce = null;
        }
        await em.save(ChannelConnectionEntity, conn);
      });
    } catch {
      // Never mask the original authorization error
    }
  }

  /**
   * Concurrency-safe token refresh (Section 7 / Test H):
   * 1. Short DB transaction claims a refresh lease (without holding a DB transaction open during the provider call).
   * 2. If another worker already holds an active lease or already incremented `credential_version`, returns the latest state without duplicate refresh or overwriting newer tokens.
   * 3. Calls provider adapter `refreshAccessToken`.
   * 4. Second short DB transaction performs compare-and-swap on `credential_version` + `refresh_lease_owner`.
   */
  async refreshCredentials(
    connectionId: string,
    actorId: string,
    dto?: RefreshConnectionTokenDto,
  ): Promise<SanitizedChannelConnectionView & { refreshed: boolean }> {
    const tenantId = TenantContext.require();
    const leaseOwner = dto?.workerId ?? `worker-${randomUUID().slice(0, 8)}`;

    // Step 1: Acquire short refresh lease in Transaction 1
    const claim = await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: connectionId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Channel connection ${connectionId} not found`,
          404,
        );
      }
      const cred = await em.getRepository(ConnectionCredentialEntity).findOne({
        where: { connectionId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cred || !cred.encryptedRefreshToken) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_REAUTH_REQUIRED,
          `Connection ${connectionId} has no refresh token; re-authorization required`,
          409,
        );
      }

      const now = new Date();
      // If another worker just refreshed within the last 2 seconds or holds an active lease, skip duplicate refresh
      if (
        cred.refreshLeaseOwner &&
        cred.refreshLeaseOwner !== leaseOwner &&
        cred.refreshLeaseExpiresAt &&
        cred.refreshLeaseExpiresAt.getTime() > now.getTime()
      ) {
        return {
          alreadyHandled: true as const,
          conn,
          cred,
        };
      }
      if (
        cred.lastRefreshedAt &&
        now.getTime() - cred.lastRefreshedAt.getTime() < 1500 &&
        cred.credentialVersion > 1
      ) {
        return {
          alreadyHandled: true as const,
          conn,
          cred,
        };
      }

      cred.refreshLeaseOwner = leaseOwner;
      cred.refreshLeaseExpiresAt = new Date(now.getTime() + 10_000);
      await em.save(ConnectionCredentialEntity, cred);

      return {
        alreadyHandled: false as const,
        conn,
        cred,
        expectedVersion: cred.credentialVersion,
        refreshToken: decryptCredentialSecret(cred.encryptedRefreshToken),
        partnerSecret: decryptCredentialSecret(cred.encryptedWebhookSecret),
        partnerId: cred.partnerId ?? `${conn.provider.toLowerCase()}-partner`,
      };
    });

    if (claim.alreadyHandled) {
      return {
        ...this.toSanitizedView(claim.conn, claim.cred),
        refreshed: false,
      };
    }

    const adapter = this.providerRegistry.getAdapter(claim.conn.provider);

    // Step 2: Call provider adapter OUTSIDE database transaction
    let refreshedTokens;
    try {
      refreshedTokens = await adapter.refreshAccessToken({
        connectionId: claim.conn.id,
        externalShopId: claim.conn.externalShopId,
        refreshToken: claim.refreshToken,
        partnerId: claim.partnerId,
        partnerSecret: claim.partnerSecret,
      });
    } catch (error) {
      // Transition to REAUTH_REQUIRED if refresh token is invalid/expired
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
          tenantId,
        ]);
        const conn = await em.getRepository(ChannelConnectionEntity).findOne({
          where: { id: connectionId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        const cred = await em
          .getRepository(ConnectionCredentialEntity)
          .findOne({
            where: { connectionId, tenantId },
            lock: { mode: 'pessimistic_write' },
          });
        if (cred && cred.refreshLeaseOwner === leaseOwner) {
          cred.refreshLeaseOwner = null;
          cred.refreshLeaseExpiresAt = null;
          await em.save(ConnectionCredentialEntity, cred);
        }
        if (conn) {
          conn.status = 'REAUTH_REQUIRED';
          conn.lastErrorCode =
            error instanceof IntegrationDomainError
              ? error.code
              : 'TOKEN_REFRESH_FAILED';
          conn.lastErrorMessage =
            error instanceof Error ? error.message : String(error);
          await em.save(ChannelConnectionEntity, conn);
          await this.outbox.enqueue(
            em,
            INTEGRATION_CONNECTION_REAUTH_REQUIRED,
            {
              tenantId,
              aggregateId: conn.id,
              actor: { id: actorId, type: 'account' },
              payload: {
                connectionId: conn.id,
                provider: conn.provider,
                externalShopId: conn.externalShopId,
                shopName: conn.shopName,
                branchId: conn.branchId,
                warehouseId: conn.warehouseId,
                status: conn.status,
                reason: conn.lastErrorMessage,
                occurredAt: new Date().toISOString(),
              } satisfies IntegrationConnectionEventPayload,
            },
          );
        }
      });
      throw error;
    }

    // Step 3: Compare-and-swap on credential_version in Transaction 2
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: connectionId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      const cred = await em.getRepository(ConnectionCredentialEntity).findOne({
        where: { connectionId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conn || !cred) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Connection ${connectionId} disappeared during token refresh`,
          404,
        );
      }

      // Guard against stale overwrite if another process already bumped credentialVersion
      if (cred.credentialVersion !== claim.expectedVersion) {
        return {
          ...this.toSanitizedView(conn, cred),
          refreshed: false,
        };
      }

      const now = new Date();
      cred.encryptedAccessToken = encryptCredentialSecret(
        refreshedTokens.accessToken,
      );
      cred.encryptedRefreshToken = encryptCredentialSecret(
        refreshedTokens.refreshToken,
      );
      cred.accessTokenExpiresAt = refreshedTokens.accessTokenExpiresAt;
      cred.refreshTokenExpiresAt = refreshedTokens.refreshTokenExpiresAt;
      cred.credentialVersion += 1;
      cred.lastRefreshedAt = now;
      cred.refreshLeaseOwner = null;
      cred.refreshLeaseExpiresAt = null;
      await em.save(ConnectionCredentialEntity, cred);

      if (
        conn.status === 'TOKEN_EXPIRED' ||
        conn.status === 'DEGRADED' ||
        conn.status === 'REAUTH_REQUIRED'
      ) {
        conn.status = 'CONNECTED';
      }
      conn.lastErrorCode = null;
      conn.lastErrorMessage = null;
      conn.version += 1;
      await em.save(ChannelConnectionEntity, conn);

      await em.save(
        IntegrationAuditLogEntity,
        em.create(IntegrationAuditLogEntity, {
          tenantId,
          connectionId: conn.id,
          actorId,
          action: 'CREDENTIALS_REFRESHED',
          targetType: 'CHANNEL_CONNECTION',
          targetId: conn.id,
          metadata: {
            credentialVersion: cred.credentialVersion,
          },
        }),
      );

      return {
        ...this.toSanitizedView(conn, cred),
        refreshed: true,
      };
    });
  }

  async pauseConnection(
    connectionId: string,
    actorId: string,
  ): Promise<SanitizedChannelConnectionView> {
    return (
      await this.transitionConnectionState(connectionId, actorId, 'PAUSED')
    ).view;
  }

  async resumeConnection(
    connectionId: string,
    actorId: string,
  ): Promise<SanitizedChannelConnectionView> {
    return (
      await this.transitionConnectionState(connectionId, actorId, 'CONNECTED')
    ).view;
  }

  async disconnectConnection(
    connectionId: string,
    actorId: string,
  ): Promise<SanitizedChannelConnectionView> {
    const { view } = await this.transitionConnectionState(
      connectionId,
      actorId,
      'DISCONNECTED',
    );
    return view;
  }

  /**
   * The disconnect of a platform admin: the same transition, token wipe, audit row and
   * `integration.connection.disconnected` event as the store's, for the store the connection belongs to (the caller
   * has found it through the admin read path), plus the admin as event actor and the reason. A repeated
   * `idempotencyKey` returns the connection again instead of failing with 400.
   */
  async disconnectConnectionAsAdmin(params: {
    tenantId: string;
    connectionId: string;
    admin: { id: string; name: string | null };
    reason: string;
    idempotencyKey?: string;
  }): Promise<{ view: SanitizedChannelConnectionView; replayed: boolean }> {
    return this.transitionConnectionState(
      params.connectionId,
      params.admin.id,
      'DISCONNECTED',
      {
        tenantId: params.tenantId,
        admin: params.admin,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey,
      },
    );
  }

  async getConnectionHealth(
    connectionId: string,
    tenantId: string = TenantContext.require(),
  ) {
    const view = await this.getConnectionById(connectionId, tenantId);
    const circuit = this.rateLimiter.getCircuitState(view.provider, view.id);
    const capabilities = this.providerRegistry
      .getAdapter(view.provider)
      .getCapabilities();
    const nowMs = Date.now();
    const tokenExpiresAtMs = view.credentialSummary.accessTokenExpiresAt
      ? new Date(view.credentialSummary.accessTokenExpiresAt).getTime()
      : null;

    return {
      connectionId: view.id,
      provider: view.provider,
      externalShopId: view.externalShopId,
      status: view.status,
      healthy:
        view.status === 'CONNECTED' &&
        circuit.state === 'CLOSED' &&
        (tokenExpiresAtMs === null || tokenExpiresAtMs > nowMs),
      circuitBreaker: circuit,
      tokenStatus: {
        hasAccessToken: view.credentialSummary.hasAccessToken,
        accessTokenExpiresAt: view.credentialSummary.accessTokenExpiresAt,
        isExpired:
          tokenExpiresAtMs !== null ? tokenExpiresAtMs <= nowMs : false,
      },
      lastSyncAt: view.lastSyncAt,
      lastOrderSyncAt: view.lastOrderSyncAt,
      lastInventorySyncAt: view.lastInventorySyncAt,
      consecutiveFailures: view.consecutiveFailures,
      lastErrorCode: view.lastErrorCode,
      capabilities,
    };
  }

  /**
   * Internal-only helper for workers/adapters. Never called directly by public HTTP controllers.
   */
  async getDecryptedCredentialsForWorker(
    tenantId: string,
    connectionId: string,
  ): Promise<DecryptedConnectionCredentials> {
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: connectionId, tenantId },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Connection ${connectionId} not found`,
          404,
        );
      }
      if (conn.status === 'DISCONNECTED' || conn.status === 'PAUSED') {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_INACTIVE,
          `Connection ${connectionId} is ${conn.status}`,
          409,
        );
      }
      const cred = await em.getRepository(ConnectionCredentialEntity).findOne({
        where: { connectionId, tenantId },
      });
      if (!cred) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_AUTHORIZATION_FAILED,
          `Credentials missing for connection ${connectionId}`,
          409,
        );
      }

      return {
        connection: conn,
        credentialVersion: cred.credentialVersion,
        accessToken: cred.encryptedAccessToken
          ? decryptCredentialSecret(cred.encryptedAccessToken)
          : '',
        refreshToken: cred.encryptedRefreshToken
          ? decryptCredentialSecret(cred.encryptedRefreshToken)
          : null,
        webhookSecret: decryptCredentialSecret(cred.encryptedWebhookSecret),
        partnerId: cred.partnerId,
      };
    });
  }

  private async transitionConnectionState(
    connectionId: string,
    actorId: string,
    targetStatus: ConnectionStatus,
    admin?: {
      tenantId: string;
      admin: { id: string; name: string | null };
      reason: string;
      idempotencyKey?: string;
    },
  ): Promise<{ view: SanitizedChannelConnectionView; replayed: boolean }> {
    const tenantId = admin?.tenantId ?? TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);
      const conn = await em.getRepository(ChannelConnectionEntity).findOne({
        where: { id: connectionId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!conn) {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_NOT_FOUND,
          `Channel connection ${connectionId} not found`,
          404,
        );
      }

      if (admin?.idempotencyKey) {
        // the row lock above makes two calls with one key take turns, so the second sees the first's audit row
        const seen = await em.query(
          `SELECT 1 FROM ${qualifiedTable(em.connection, 'integration_audit_logs')}
           WHERE "tenant_id" = $1 AND "connection_id" = $2 AND "action" = 'CONNECTION_DISCONNECTED'
             AND "metadata"->>'idempotencyKey' = $3 LIMIT 1`,
          [tenantId, conn.id, admin.idempotencyKey],
        );
        if (seen.length > 0) {
          const cred = await em
            .getRepository(ConnectionCredentialEntity)
            .findOne({ where: { connectionId, tenantId } });
          return {
            view: this.toSanitizedView(conn, cred ?? undefined),
            replayed: true,
          };
        }
      }
      if (admin && conn.status === 'DISCONNECTED') {
        throw new IntegrationDomainError(
          IntegrationDomainErrorCode.CHANNEL_CONNECTION_ALREADY_DISCONNECTED,
          `Channel connection ${connectionId} is already disconnected`,
          400,
        );
      }

      assertValidConnectionTransition(conn.status, targetStatus);
      conn.status = targetStatus;
      conn.version += 1;
      await em.save(ChannelConnectionEntity, conn);

      const cred = await em.getRepository(ConnectionCredentialEntity).findOne({
        where: { connectionId, tenantId },
      });

      if (targetStatus === 'DISCONNECTED' && cred) {
        cred.encryptedAccessToken = null;
        cred.encryptedRefreshToken = null;
        cred.credentialVersion += 1;
        await em.save(ConnectionCredentialEntity, cred);

        await this.outbox.enqueue(em, INTEGRATION_CONNECTION_DISCONNECTED, {
          tenantId,
          aggregateId: conn.id,
          actor: {
            id: actorId,
            type: admin ? 'platform_admin' : 'account',
          },
          payload: {
            connectionId: conn.id,
            provider: conn.provider,
            externalShopId: conn.externalShopId,
            shopName: conn.shopName,
            branchId: conn.branchId,
            warehouseId: conn.warehouseId,
            status: conn.status,
            occurredAt: new Date().toISOString(),
            ...(admin
              ? {
                  actor: {
                    type: 'platform_admin',
                    id: admin.admin.id,
                    name: admin.admin.name,
                  },
                  reason: admin.reason,
                }
              : {}),
          } satisfies IntegrationConnectionEventPayload,
        });
      }

      await em.save(
        IntegrationAuditLogEntity,
        em.create(IntegrationAuditLogEntity, {
          tenantId,
          connectionId: conn.id,
          actorId,
          action: `CONNECTION_${targetStatus}`,
          targetType: 'CHANNEL_CONNECTION',
          targetId: conn.id,
          metadata: {
            status: targetStatus,
            ...(admin
              ? {
                  actorType: 'platform_admin',
                  reason: admin.reason,
                  ...(admin.idempotencyKey
                    ? { idempotencyKey: admin.idempotencyKey }
                    : {}),
                }
              : {}),
          },
        }),
      );

      return {
        view: this.toSanitizedView(conn, cred ?? undefined),
        replayed: false,
      };
    });
  }

  private toSanitizedView(
    conn: ChannelConnectionEntity,
    cred?: ConnectionCredentialEntity,
  ): SanitizedChannelConnectionView {
    return {
      id: conn.id,
      tenantId: conn.tenantId,
      code: conn.code,
      provider: conn.provider,
      connectionKey: conn.connectionKey,
      externalShopId: conn.externalShopId,
      shopName: conn.shopName,
      branchId: conn.branchId,
      warehouseId: conn.warehouseId,
      status: conn.status,
      safetyStockBuffer: conn.safetyStockBuffer,
      stockAllocationPercent: conn.stockAllocationPercent,
      lastSyncAt: conn.lastSyncAt ? conn.lastSyncAt.toISOString() : null,
      lastOrderSyncAt: conn.lastOrderSyncAt
        ? conn.lastOrderSyncAt.toISOString()
        : null,
      lastInventorySyncAt: conn.lastInventorySyncAt
        ? conn.lastInventorySyncAt.toISOString()
        : null,
      lastErrorCode: conn.lastErrorCode,
      lastErrorMessage: conn.lastErrorMessage,
      consecutiveFailures: conn.consecutiveFailures,
      credentialSummary: {
        credentialVersion: cred?.credentialVersion ?? 0,
        hasAccessToken: Boolean(cred?.encryptedAccessToken),
        hasRefreshToken: Boolean(cred?.encryptedRefreshToken),
        accessTokenExpiresAt: cred?.accessTokenExpiresAt
          ? cred.accessTokenExpiresAt.toISOString()
          : null,
        refreshTokenExpiresAt: cred?.refreshTokenExpiresAt
          ? cred.refreshTokenExpiresAt.toISOString()
          : null,
        lastRefreshedAt: cred?.lastRefreshedAt
          ? cred.lastRefreshedAt.toISOString()
          : null,
      },
      createdAt: conn.createdAt.toISOString(),
      updatedAt: conn.updatedAt.toISOString(),
    };
  }
}
