import { Injectable } from '@nestjs/common';
import { InjectTenantRepository, TenantScopedRepository } from '@pbl/common';
import { In } from 'typeorm';
import {
  CatalogDomainError,
  CatalogErrorCode,
  normalizeName,
} from '../../domain/catalog-domain';
import {
  AttributeEntity,
  AttributeValueEntity,
} from '../../infrastructure/persistence/catalog.entities';
import { toCatalogHttpException } from '../../presentation/catalog-http-error';
import {
  AttributeRes,
  AttributeValueRes,
  CreateAttributeReqDto,
  CreateAttributeValueReqDto,
  UpdateAttributeReqDto,
} from './attributes.dto';

@Injectable()
export class AttributesService {
  constructor(
    @InjectTenantRepository(AttributeEntity)
    private readonly attributesRepo: TenantScopedRepository<AttributeEntity>,
    @InjectTenantRepository(AttributeValueEntity)
    private readonly valuesRepo: TenantScopedRepository<AttributeValueEntity>,
  ) {}

  private toValRes(v: AttributeValueEntity): AttributeValueRes {
    return {
      id: v.id,
      attributeId: v.attributeId,
      value: v.value,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  async createAttribute(dto: CreateAttributeReqDto): Promise<AttributeRes> {
    try {
      const normalizedName = normalizeName(dto.name);
      return await this.attributesRepo.transaction(async (scoped) => {
        const saved = await scoped.save({
          name: dto.name.trim(),
          normalizedName,
        });
        return {
          id: saved.id,
          name: saved.name,
          values: [],
          createdAt: saved.createdAt.toISOString(),
          updatedAt: saved.updatedAt.toISOString(),
        };
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async listAttributes(): Promise<AttributeRes[]> {
    try {
      return await this.attributesRepo.transaction(async (scoped, em) => {
        const attrs = await scoped.find({
          order: { name: 'ASC', id: 'ASC' },
        });
        if (attrs.length === 0) return [];

        const values = await this.valuesRepo.withManager(em).find({
          where: { attributeId: In(attrs.map((a) => a.id)) },
          order: { value: 'ASC', id: 'ASC' },
        });

        const byAttr = new Map<string, AttributeValueRes[]>();
        for (const v of values) {
          const list = byAttr.get(v.attributeId) ?? [];
          list.push(this.toValRes(v));
          byAttr.set(v.attributeId, list);
        }

        return attrs.map((a) => ({
          id: a.id,
          name: a.name,
          values: byAttr.get(a.id) ?? [],
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        }));
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async updateAttribute(
    id: string,
    dto: UpdateAttributeReqDto,
  ): Promise<AttributeRes> {
    try {
      return await this.attributesRepo.transaction(async (scoped, em) => {
        const attr = await scoped.findOneBy({ id });
        if (!attr) {
          throw new CatalogDomainError(
            CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
            'Attribute not found',
            'NOT_FOUND',
          );
        }
        attr.name = dto.name.trim();
        attr.normalizedName = normalizeName(dto.name);
        const saved = await scoped.save(attr);
        const values = await this.valuesRepo.withManager(em).find({
          where: { attributeId: id },
          order: { value: 'ASC', id: 'ASC' },
        });
        return {
          id: saved.id,
          name: saved.name,
          values: values.map((v) => this.toValRes(v)),
          createdAt: saved.createdAt.toISOString(),
          updatedAt: saved.updatedAt.toISOString(),
        };
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async createValue(
    attributeId: string,
    dto: CreateAttributeValueReqDto,
  ): Promise<AttributeValueRes> {
    try {
      const normalizedValue = normalizeName(dto.value);
      return await this.valuesRepo.transaction(async (scopedVal, em) => {
        const attr = await this.attributesRepo
          .withManager(em)
          .findOneBy({ id: attributeId });
        if (!attr) {
          throw new CatalogDomainError(
            CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
            'Attribute not found',
            'NOT_FOUND',
          );
        }
        const saved = await scopedVal.save({
          attributeId,
          value: dto.value.trim(),
          normalizedValue,
        });
        return this.toValRes(saved);
      });
    } catch (error) {
      toCatalogHttpException(error);
    }
  }

  async listValues(attributeId: string): Promise<AttributeValueRes[]> {
    try {
      const attr = await this.attributesRepo.findOneBy({ id: attributeId });
      if (!attr) {
        throw new CatalogDomainError(
          CatalogErrorCode.ATTRIBUTE_NOT_FOUND,
          'Attribute not found',
          'NOT_FOUND',
        );
      }
      const values = await this.valuesRepo.find({
        where: { attributeId },
        order: { value: 'ASC', id: 'ASC' },
      });
      return values.map((v) => this.toValRes(v));
    } catch (error) {
      toCatalogHttpException(error);
    }
  }
}
