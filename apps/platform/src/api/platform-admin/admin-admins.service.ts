import { OffsetPaginationDto } from '@/common/dto/offset-pagination/offset-pagination.dto';
import { Order } from '@/constants/app.constant';
import { ErrorCode } from '@/constants/error-code.constant';
import { ValidationException } from '@/exceptions/validation.exception';
import { isUniqueViolation } from '@/utils/db-errors';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Brackets, DataSource, EntityManager } from 'typeorm';
import { SessionService } from '../auth/session.service';
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
      const saved = await admins.save(
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
      admin.role = role;
      admin.status = status;
      admin.updatedBy = callerId;
      return { saved: await em.save(admin), endSessions: disabled || demoted };
    });
    // disabling or demoting ends the admin's sessions at once, so the old token's powers do not outlive the change (D36)
    if (result.endSessions) await this.sessions.revokeAllOfAdmin(id);
    return this.toItem(result.saved);
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
