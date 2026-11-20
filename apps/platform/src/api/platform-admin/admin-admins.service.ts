import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { Order } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FieldChanges,
  PLATFORM_ADMIN_CREATED,
  PLATFORM_ADMIN_UPDATED,
  PlatformAdminEventPayload,
} from '@pbl/contracts';
import { EventOutbox } from '@pbl/events';
import { Brackets, DataSource, EntityManager } from 'typeorm';
import { SessionService } from '../auth/session.service';
import { loadAdminActor } from './admin-actor';
import {
  CreateAdminReqDto,
  ListAdminsReqDto,
  UpdateAdminReqDto,
} from './dto/admin-admin.req.dto';
import {
  PlatformAdminEntity,
  PlatformAdminRole,
  PlatformAdminStatus,
} from './entities/platform-admin.entity';

export type AdminAdminItem = {
  id: string;
  name: string;
  email: string;
  role: PlatformAdminRole;
  status: PlatformAdminStatus;
  lastLoginAt: string | null;
};

/** Platform admins managing platform admins (contract 04, "Accounts and admins"); writes are `super_admin` only */
@Injectable()
export class AdminAdminsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: SessionService,
    private readonly outbox: EventOutbox,
  ) {}

  async list(query: ListAdminsReqDto): Promise<{
    data: AdminAdminItem[];
    pagination: OffsetPaginationDto;
  }> {
    const builder = this.dataSource
      .getRepository(PlatformAdminEntity)
      .createQueryBuilder('a');
    if (query.role) builder.andWhere('a.role = :role', { role: query.role });
    if (query.status) {
      builder.andWhere('a.status = :status', { status: query.status });
    }
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      builder.andWhere(
        new Brackets((qb) =>
          qb
            .where('a.name ILIKE :like', { like })
            .orWhere('a.email ILIKE :like', { like }),
        ),
      );
    }
    const [rows, total] = await builder
      .orderBy('a.createdAt', query.order === Order.DESC ? 'DESC' : 'ASC')
      .addOrderBy('a.id')
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();
    return {
      data: rows.map((r) => this.toItem(r)),
      pagination: new OffsetPaginationDto(total, query),
    };
  }

  async create(
    callerId: string,
    dto: CreateAdminReqDto,
  ): Promise<AdminAdminItem> {
    const admins = this.dataSource.getRepository(PlatformAdminEntity);
    if (await admins.exists({ where: { email: dto.email } })) {
      throw new ValidationException(ErrorCode.A010);
    }
    try {
      // the admin and its event commit together; the event never carries the password or its hash
      const saved = await this.dataSource.transaction(async (em) => {
        const created = await em.save(
          new PlatformAdminEntity({
            email: dto.email,
            name: dto.name.trim(),
            role: dto.role,
            status: PlatformAdminStatus.ACTIVE,
            password: dto.password ?? null, // hashed by the entity
            createdBy: callerId,
            updatedBy: callerId,
          }),
        );
        await this.emit(em, PLATFORM_ADMIN_CREATED, callerId, created);
        return created;
      });
      return this.toItem(saved);
    } catch (error) {
      // Two creations raced past the check; the unique index decided
      if (isUniqueViolation(error, 'UQ_platform_admin_email')) {
        throw new ValidationException(ErrorCode.A010);
      }
      throw error;
    }
  }

  /**
   * Changes an admin's role or status. Refused (A011) when it would leave the caller unable to act, or the platform
   * without a super admin. Disabling ends the admin's sessions.
   */
  async update(
    callerId: string,
    id: string,
    dto: UpdateAdminReqDto,
  ): Promise<AdminAdminItem> {
    const result = await this.dataSource.transaction(async (em) => {
      // Two changes at once could each leave "another" super admin standing and together leave none
      await em.query(
        `SELECT pg_advisory_xact_lock(hashtext('platform_admin_roles'))`,
      );
      const admin = await em.findOneBy(PlatformAdminEntity, {
        id: id as never,
      });
      if (!admin) throw new NotFoundException();
      const role = dto.role ?? admin.role;
      const status = dto.status ?? admin.status;
      const demoted =
        admin.role === PlatformAdminRole.SUPER_ADMIN && role !== admin.role;
      const disabled =
        admin.status === PlatformAdminStatus.ACTIVE &&
        status === PlatformAdminStatus.DISABLED;
      if (admin.id === callerId && (demoted || disabled)) {
        throw new ValidationException(ErrorCode.A011);
      }
      const wasActiveSuper =
        admin.role === PlatformAdminRole.SUPER_ADMIN &&
        admin.status === PlatformAdminStatus.ACTIVE;
      const staysActiveSuper =
        role === PlatformAdminRole.SUPER_ADMIN &&
        status === PlatformAdminStatus.ACTIVE;
      if (wasActiveSuper && !staysActiveSuper) {
        if ((await this.otherActiveSuperAdmins(em, admin.id)) === 0) {
          throw new ValidationException(ErrorCode.A011);
        }
      }
      const changes: FieldChanges = {};
      if (role !== admin.role) changes.role = { from: admin.role, to: role };
      if (status !== admin.status) {
        changes.status = { from: admin.status, to: status };
      }
      admin.role = role;
      admin.status = status;
      admin.updatedBy = callerId;
      const saved = await em.save(admin);
      if (Object.keys(changes).length > 0) {
        await this.emit(em, PLATFORM_ADMIN_UPDATED, callerId, saved, changes);
      }
      return { saved, endSessions: disabled || demoted };
    });
    // disabling or demoting ends the admin's sessions at once, so the old token's powers do not outlive the change (D36)
    if (result.endSessions) await this.sessions.revokeAllOfAdmin(id);
    return this.toItem(result.saved);
  }

  private async emit(
    em: EntityManager,
    event: typeof PLATFORM_ADMIN_CREATED | typeof PLATFORM_ADMIN_UPDATED,
    callerId: string,
    admin: PlatformAdminEntity,
    changes?: FieldChanges,
  ): Promise<void> {
    const payload: PlatformAdminEventPayload = {
      actor: await loadAdminActor(em, callerId),
      target: {
        type: 'admin',
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        status: admin.status,
      },
      ...(changes ? { changes } : {}),
    };
    await this.outbox.add(em, event, payload, { tenantId: null });
  }

  private otherActiveSuperAdmins(em: EntityManager, exceptId: string) {
    return em
      .createQueryBuilder(PlatformAdminEntity, 'a')
      .where('a.role = :role', { role: PlatformAdminRole.SUPER_ADMIN })
      .andWhere('a.status = :status', { status: PlatformAdminStatus.ACTIVE })
      .andWhere('a.id != :exceptId', { exceptId })
      .getCount();
  }

  private toItem(a: PlatformAdminEntity): AdminAdminItem {
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      role: a.role,
      status: a.status,
      lastLoginAt: a.lastLoginAt ? a.lastLoginAt.toISOString() : null,
    };
  }
}
