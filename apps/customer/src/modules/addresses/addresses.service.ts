import { Injectable } from '@nestjs/common';
import { TenantContext } from '@pbl/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  CustomerDomainError,
  CustomerDomainErrorCode,
  normalizePhoneNumber,
} from '../../domain/customer-domain';
import { getSchemaPrefix } from '../../infrastructure/persistence/customer-code.generator';
import {
  CustomerAddressEntity,
  CustomerEntity,
} from '../../infrastructure/persistence/customer.entities';
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './addresses.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly dataSource: DataSource) {}

  async addAddress(
    customerId: string,
    dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddressEntity> {
    const tenantId = TenantContext.require();
    const phoneNormalized = normalizePhoneNumber(dto.phone);
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      // Lock customer row to serialize concurrent default-address assignments
      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!customer || customer.deletedAt) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer ${customerId} not found`,
          404,
        );
      }

      const activeAddressesCount = await em
        .getRepository(CustomerAddressEntity)
        .count({
          where: { tenantId, customerId, status: 'ACTIVE' },
        });

      const shouldBeDefault =
        dto.isDefault === true || activeAddressesCount === 0;

      if (shouldBeDefault) {
        await em.query(
          `UPDATE ${prefix}"customer_addresses"
           SET is_default = false, updated_at = now()
           WHERE tenant_id = $1 AND customer_id = $2 AND is_default = true`,
          [tenantId, customerId],
        );
      }

      const address = em.create(CustomerAddressEntity, {
        id: randomUUID(),
        tenantId,
        customerId,
        recipientName: dto.recipientName.trim(),
        phone: dto.phone?.trim() ?? null,
        phoneNormalized,
        addressLine: dto.addressLine.trim(),
        ward: dto.ward?.trim() ?? null,
        district: dto.district?.trim() ?? null,
        province: dto.province?.trim() ?? null,
        isDefault: shouldBeDefault,
        status: 'ACTIVE',
      });

      return em.save(CustomerAddressEntity, address);
    });
  }

  async listAddresses(customerId: string): Promise<CustomerAddressEntity[]> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
      });
      if (!customer || customer.deletedAt) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer ${customerId} not found`,
          404,
        );
      }

      return em.getRepository(CustomerAddressEntity).find({
        where: { tenantId, customerId, status: 'ACTIVE' },
        order: { isDefault: 'DESC', createdAt: 'ASC' },
      });
    });
  }

  async updateAddress(
    customerId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressEntity> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      const address = await em.getRepository(CustomerAddressEntity).findOne({
        where: { id: addressId, customerId, tenantId, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!address) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_ADDRESS_NOT_FOUND,
          `Address ${addressId} not found for customer ${customerId}`,
          404,
        );
      }

      if (dto.recipientName !== undefined) {
        address.recipientName = dto.recipientName.trim();
      }
      if (dto.phone !== undefined) {
        address.phone = dto.phone?.trim() ?? null;
        address.phoneNormalized = normalizePhoneNumber(dto.phone);
      }
      if (dto.addressLine !== undefined) {
        address.addressLine = dto.addressLine.trim();
      }
      if (dto.ward !== undefined) {
        address.ward = dto.ward?.trim() ?? null;
      }
      if (dto.district !== undefined) {
        address.district = dto.district?.trim() ?? null;
      }
      if (dto.province !== undefined) {
        address.province = dto.province?.trim() ?? null;
      }
      if (dto.isDefault === true && !address.isDefault) {
        await em.query(
          `UPDATE ${prefix}"customer_addresses"
           SET is_default = false, updated_at = now()
           WHERE tenant_id = $1 AND customer_id = $2 AND is_default = true AND id <> $3`,
          [tenantId, customerId, addressId],
        );
        address.isDefault = true;
      } else if (dto.isDefault === false) {
        address.isDefault = false;
      }

      address.updatedAt = new Date();
      return em.save(CustomerAddressEntity, address);
    });
  }

  async setDefaultAddress(
    customerId: string,
    addressId: string,
  ): Promise<CustomerAddressEntity> {
    const tenantId = TenantContext.require();
    const prefix = getSchemaPrefix(this.dataSource);

    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      // Serialize concurrent set-default calls by locking the parent customer row
      const customer = await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!customer || customer.deletedAt) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_NOT_FOUND,
          `Customer ${customerId} not found`,
          404,
        );
      }

      const address = await em.getRepository(CustomerAddressEntity).findOne({
        where: { id: addressId, customerId, tenantId, status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
      if (!address) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_ADDRESS_NOT_FOUND,
          `Address ${addressId} not found for customer ${customerId}`,
          404,
        );
      }

      await em.query(
        `UPDATE ${prefix}"customer_addresses"
         SET is_default = false, updated_at = now()
         WHERE tenant_id = $1 AND customer_id = $2 AND is_default = true AND id <> $3`,
        [tenantId, customerId, addressId],
      );

      address.isDefault = true;
      address.updatedAt = new Date();
      return em.save(CustomerAddressEntity, address);
    });
  }

  async deactivateAddress(
    customerId: string,
    addressId: string,
  ): Promise<{ id: string; status: 'INACTIVE' }> {
    const tenantId = TenantContext.require();
    return this.dataSource.transaction(async (em) => {
      await em.query(`SELECT set_config('app.tenant_id', $1, true)`, [
        tenantId,
      ]);

      await em.getRepository(CustomerEntity).findOne({
        where: { id: customerId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      const address = await em.getRepository(CustomerAddressEntity).findOne({
        where: { id: addressId, customerId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!address) {
        throw new CustomerDomainError(
          CustomerDomainErrorCode.CUSTOMER_ADDRESS_NOT_FOUND,
          `Address ${addressId} not found for customer ${customerId}`,
          404,
        );
      }

      address.isDefault = false;
      address.status = 'INACTIVE';
      address.updatedAt = new Date();
      await em.save(CustomerAddressEntity, address);
      return { id: address.id, status: 'INACTIVE' };
    });
  }
}
