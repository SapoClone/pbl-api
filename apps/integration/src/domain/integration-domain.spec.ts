import {
  IntegrationDomainError,
  IntegrationDomainErrorCode,
  assertValidConnectionTransition,
  assertWebhookTimestampFreshness,
  calculateBackoffDelayMs,
  calculateChannelPublishableQuantity,
  classifyIntegrationError,
  computeLazadaApiSignature,
  computeLazadaWebhookSignature,
  computeShopeeApiSignature,
  computeShopeeWebhookSignature,
  decryptCredentialSecret,
  encryptCredentialSecret,
  evaluateExternalStatusProgression,
  normalizeProviderOrderStatus,
  redactSensitiveObject,
  shouldApplyInventoryStockVersion,
  verifyLazadaWebhookSignature,
  verifyShopeeWebhookSignature,
} from './integration-domain';

describe('M6 Integration Domain Model Unit Tests', () => {
  describe('Connection lifecycle transitions', () => {
    it('allows legal transitions and rejects illegal transitions', () => {
      expect(() =>
        assertValidConnectionTransition('PENDING_AUTH', 'CONNECTED'),
      ).not.toThrow();
      expect(() =>
        assertValidConnectionTransition('CONNECTED', 'PAUSED'),
      ).not.toThrow();
      expect(() =>
        assertValidConnectionTransition('PAUSED', 'CONNECTED'),
      ).not.toThrow();
      expect(() =>
        assertValidConnectionTransition('PENDING_AUTH', 'PAUSED'),
      ).toThrow(IntegrationDomainError);
    });
  });

  describe('Credential AES-256-GCM envelope encryption and redaction', () => {
    it('encrypts and decrypts secrets round-trip with distinct random IVs', () => {
      const secret = 'shp_access_token_live_987654321';
      const c1 = encryptCredentialSecret(secret);
      const c2 = encryptCredentialSecret(secret);
      expect(c1).not.toEqual(c2);
      expect(c1).not.toContain(secret);
      expect(decryptCredentialSecret(c1)).toBe(secret);
      expect(decryptCredentialSecret(c2)).toBe(secret);
    });

    it('rejects tampered ciphertext', () => {
      const c = encryptCredentialSecret('top-secret');
      const tampered = c.slice(0, -4) + 'AAAA';
      expect(() => decryptCredentialSecret(tampered)).toThrow();
    });

    it('redacts sensitive token/secret fields recursively', () => {
      const sanitized = redactSensitiveObject({
        shopId: '123',
        accessToken: 'secret-at',
        nested: {
          refreshToken: 'secret-rt',
          webhookSecret: 'secret-wh',
          safeField: 'visible',
        },
      });
      expect(sanitized).toEqual({
        shopId: '123',
        accessToken: '[REDACTED]',
        nested: {
          refreshToken: '[REDACTED]',
          webhookSecret: '[REDACTED]',
          safeField: 'visible',
        },
      });
    });
  });

  describe('Shopee v2 & Lazada cryptographic signatures and webhook verification', () => {
    it('verifies valid Shopee v2 webhook HMAC-SHA256 over url|rawBody and rejects tampered body', () => {
      const url =
        'https://api.sapoclone.vn/webhooks/v1/shopee/ck_shopee_abc123';
      const rawBody = Buffer.from(
        JSON.stringify({
          code: 3,
          shop_id: 998877,
          timestamp: 1700000000,
          data: { ordersn: 'SHP20261030001', status: 'READY_TO_SHIP' },
        }),
        'utf8',
      );
      const partnerKey = 'shopee_partner_secret_key_test';
      const sig = computeShopeeWebhookSignature(url, rawBody, partnerKey);

      expect(
        verifyShopeeWebhookSignature({
          webhookUrl: url,
          rawBody,
          partnerKey,
          providedSignature: sig,
        }),
      ).toBe(true);

      expect(
        verifyShopeeWebhookSignature({
          webhookUrl: url,
          rawBody: Buffer.from(rawBody.toString('utf8') + ' '),
          partnerKey,
          providedSignature: sig,
        }),
      ).toBe(false);
    });

    it('computes deterministic Shopee v2 and Lazada API request signatures', () => {
      const shpSign = computeShopeeApiSignature({
        partnerId: '10001',
        partnerKey: 'shp_secret',
        apiPath: '/api/v2/product/update_stock',
        timestamp: 1700000000,
        accessToken: 'at_1',
        shopId: '5001',
      });
      expect(shpSign).toHaveLength(64);

      const lzdSign = computeLazadaApiSignature({
        appSecret: 'lzd_secret',
        apiPath: '/orders/get',
        queryParams: {
          app_key: '20002',
          timestamp: 1700000000000,
          sign_method: 'sha256',
        },
      });
      expect(lzdSign).toHaveLength(64);
      expect(lzdSign).toBe(lzdSign.toUpperCase());
    });

    it('verifies valid Lazada webhook signature and enforces replay window', () => {
      const rawBody =
        '{"seller_id":"LZD-01","message_type":0,"timestamp":1700000000}';
      const secret = 'lzd_webhook_secret';
      const sig = computeLazadaWebhookSignature(rawBody, secret);

      expect(
        verifyLazadaWebhookSignature({
          rawBody,
          appSecret: secret,
          providedSignature: sig,
        }),
      ).toBe(true);

      expect(() =>
        assertWebhookTimestampFreshness(1700000000, 1700000100 * 1000, 300),
      ).not.toThrow();

      expect(() =>
        assertWebhookTimestampFreshness(1700000000, 1700000900 * 1000, 300),
      ).toThrow(IntegrationDomainError);
    });
  });

  describe('Order status normalization and out-of-order progression protection', () => {
    it('normalizes Shopee and Lazada order statuses accurately', () => {
      expect(normalizeProviderOrderStatus('SHOPEE', 'READY_TO_SHIP')).toBe(
        'READY_TO_SHIP',
      );
      expect(normalizeProviderOrderStatus('SHOPEE', 'COMPLETED')).toBe(
        'DELIVERED',
      );
      expect(normalizeProviderOrderStatus('LAZADA', 'packed')).toBe(
        'READY_TO_SHIP',
      );
      expect(normalizeProviderOrderStatus('LAZADA', 'canceled')).toBe(
        'CANCELLED',
      );
    });

    it('ignores stale out-of-order status updates and flags DELIVERED -> CANCELLED conflicts', () => {
      const stale = evaluateExternalStatusProgression({
        currentStatus: 'SHIPPED',
        currentRank: 30,
        incomingStatus: 'READY_TO_SHIP',
      });
      expect(stale.outcome).toBe('IGNORE_STALE');

      const forward = evaluateExternalStatusProgression({
        currentStatus: 'READY_TO_SHIP',
        currentRank: 20,
        incomingStatus: 'SHIPPED',
      });
      expect(forward.outcome).toBe('APPLY');
      expect(forward.targetRank).toBe(30);

      const conflict = evaluateExternalStatusProgression({
        currentStatus: 'DELIVERED',
        currentRank: 40,
        incomingStatus: 'CANCELLED',
      });
      expect(conflict.outcome).toBe('CONFLICT_RECONCILIATION_REQUIRED');
    });
  });

  describe('Sellable inventory calculation & stale version guard', () => {
    it('calculates publishable quantity with safety buffer and allocation percent', () => {
      const res = calculateChannelPublishableQuantity({
        onHandQty: 10,
        reservedQty: 2,
        safetyBuffer: 2,
        allocationPercent: 100,
      });
      expect(res).toEqual({
        availableQty: 8,
        afterBufferQty: 6,
        publishableQty: 6,
      });

      const zeroFloor = calculateChannelPublishableQuantity({
        onHandQty: 3,
        reservedQty: 2,
        safetyBuffer: 5,
        allocationPercent: 80,
      });
      expect(zeroFloor.publishableQty).toBe(0);
    });

    it('rejects stale stock versions', () => {
      expect(shouldApplyInventoryStockVersion(11, 10)).toBe(false);
      expect(shouldApplyInventoryStockVersion(11, 11)).toBe(false);
      expect(shouldApplyInventoryStockVersion(10, 11)).toBe(true);
    });
  });

  describe('Error classification and backoff', () => {
    it('respects Retry-After on HTTP 429 and classifies transient vs permanent errors', () => {
      const rateLimitErr = new IntegrationDomainError(
        IntegrationDomainErrorCode.PROVIDER_RATE_LIMITED,
        '429',
        429,
        { retryAfterSeconds: 7 },
      );
      const classified = classifyIntegrationError(rateLimitErr);
      expect(classified.category).toBe('TRANSIENT');
      expect(classified.retryable).toBe(true);
      expect(classified.retryAfterSeconds).toBe(7);

      const delay = calculateBackoffDelayMs({
        attemptCount: 2,
        retryAfterSeconds: classified.retryAfterSeconds,
      });
      expect(delay).toBe(7000);
    });
  });
});
