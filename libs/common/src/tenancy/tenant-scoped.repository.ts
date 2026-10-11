import {
  DataSource,
  DeepPartial,
  DeleteResult,
  EntityManager,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsSelect,
  FindOptionsWhere,
  In,
  Not,
  ObjectLiteral,
  Repository,
  SaveOptions,
  SelectQueryBuilder,
  UpdateResult,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { TenantContext } from './tenant-context';

/** Bound by createQueryBuilder; a name callers will not pick themselves */
export const TENANT_PARAMETER = '__pbl_tenant_id';

/**
 * A query or entity names a tenant other than the context's. Like a missing
 * context, this is a programming error: a plain Error, so a 500.
 */
export class TenantMismatchError extends Error {
  constructor(what: string) {
    super(`${what} belongs to another tenant than the current context`);
    this.name = 'TenantMismatchError';
  }
}

type TenantOwned = ObjectLiteral & { tenantId: string };
type Where<T> = FindOptionsWhere<T> | FindOptionsWhere<T>[];
type IdValue = string | number | Date;
/** What TypeORM's update/delete/softDelete accept, minus Mongo ids */
export type WriteCriteria<T> =
  | IdValue
  | IdValue[]
  | FindOptionsWhere<T>
  | FindOptionsWhere<T>[];

const isIdValue = (value: unknown): value is IdValue =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  value instanceof Date;

const isWhereObject = (value: unknown): value is ObjectLiteral =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

/** A caller may repeat the context tenant, never name another (or an operator) */
const assertSameTenant = (value: unknown, tenantId: string, what: string) => {
  if (value !== undefined && value !== tenantId) {
    throw new TenantMismatchError(what);
  }
};

const EMPTY_WRITE = { raw: [], affected: 0, generatedMaps: [] };

/**
 * Data access for an entity with a `tenantId` column, scoped to
 * TenantContext.require() (ADR-0008, Jira SCRUM-32):
 *
 * - reads (`find`, `findOne`, `findOneBy`, `count`, `exists`, `findAndCount`)
 *   and writes (`update`, `softDelete`, `delete`) get `tenantId` added to
 *   every where object, including each object of an OR array;
 * - `save` sets `tenantId` when absent, refuses another tenant's, and refuses
 *   an id that exists in another tenant (TypeORM would UPDATE that row);
 * - `save` and `update` also refuse a relation mapped to the tenant column
 *   (e.g. `tenant` with `@JoinColumn({ name: 'tenant_id' })`) that points to
 *   another tenant: TypeORM takes the column value from the relation first;
 * - `createQueryBuilder(alias)` returns a builder whose tenant condition is
 *   ANDed outside the caller's where/orWhere, so neither replaces it. With a
 *   join plus skip/take TypeORM pages through a distinct-ids query built from
 *   this builder, so the ids are already tenant-filtered (pinned by e2e);
 * - outside a tenant context (or with a null tenant) every method throws
 *   MissingTenantContextError instead of reaching all tenants' rows.
 *
 * Use `transaction(fn)` (or `withManager(em)` with your own EntityManager)
 * inside a transaction. Joined relations are not filtered: join only through
 * tenant-owned foreign keys, or scope them. `Raw(...)` where fragments must
 * be parenthesised (`Raw((a) => `(${a} = 1 OR ${a} = 2)`)`): TypeORM does not
 * wrap them before ANDing the tenant condition.
 */
export class TenantScopedRepository<T extends TenantOwned> {
  constructor(private readonly repository: Repository<T>) {}

  static forEntity<T extends TenantOwned>(
    source: DataSource | EntityManager,
    entity: EntityTarget<T>,
  ): TenantScopedRepository<T> {
    return new TenantScopedRepository<T>(source.getRepository(entity));
  }

  /** The same wrapper over a transaction's EntityManager */
  withManager(manager: EntityManager): TenantScopedRepository<T> {
    return new TenantScopedRepository<T>(
      manager.getRepository<T>(this.repository.target),
    );
  }

  /**
   * Runs `work` in a transaction, with this wrapper bound to it (`scoped`)
   * and the transaction's EntityManager (`em`, unscoped: for other entities,
   * locks, ...).
   */
  transaction<R>(
    work: (scoped: TenantScopedRepository<T>, em: EntityManager) => Promise<R>,
  ): Promise<R> {
    return this.repository.manager.transaction((em) =>
      work(this.withManager(em), em),
    );
  }

  async find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.repository.find(this.scopeOptions(options));
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repository.findOne(this.scopeOptions(options));
  }

  async findOneBy(where: Where<T>): Promise<T | null> {
    return this.repository.findOneBy(
      this.scopeWhere(where, TenantContext.require()),
    );
  }

  async count(options: FindManyOptions<T> = {}): Promise<number> {
    return this.repository.count(this.scopeOptions(options));
  }

  async exists(options: FindManyOptions<T> = {}): Promise<boolean> {
    return this.repository.exists(this.scopeOptions(options));
  }

  async findAndCount(options: FindManyOptions<T> = {}): Promise<[T[], number]> {
    return this.repository.findAndCount(this.scopeOptions(options));
  }

  save<E extends DeepPartial<T>>(
    entities: E[],
    options?: SaveOptions,
  ): Promise<(E & T)[]>;
  save<E extends DeepPartial<T>>(
    entity: E,
    options?: SaveOptions,
  ): Promise<E & T>;
  async save<E extends DeepPartial<T>>(
    entityOrEntities: E | E[],
    options?: SaveOptions,
  ): Promise<(E & T) | (E & T)[]> {
    const tenantId = TenantContext.require();
    const entities = Array.isArray(entityOrEntities)
      ? entityOrEntities
      : [entityOrEntities];
    for (const entity of entities) {
      assertSameTenant(entity.tenantId, tenantId, 'Entity');
      this.assertTenantRelations(entity, tenantId, 'Entity');
    }
    await this.assertNoForeignRows(entities, tenantId);
    for (const entity of entities) {
      (entity as ObjectLiteral).tenantId = tenantId;
    }
    return this.repository.save(entityOrEntities as any, options);
  }

  async update(
    criteria: WriteCriteria<T>,
    partial: QueryDeepPartialEntity<T>,
  ): Promise<UpdateResult> {
    const tenantId = TenantContext.require();
    assertSameTenant((partial as ObjectLiteral)?.tenantId, tenantId, 'Update');
    this.assertTenantRelations(partial as ObjectLiteral, tenantId, 'Update');
    const where = await this.writeWhere(criteria, tenantId);
    return where ? this.repository.update(where, partial) : EMPTY_WRITE;
  }

  async softDelete(criteria: WriteCriteria<T>): Promise<UpdateResult> {
    const where = await this.writeWhere(criteria, TenantContext.require());
    return where ? this.repository.softDelete(where) : EMPTY_WRITE;
  }

  async delete(criteria: WriteCriteria<T>): Promise<DeleteResult> {
    const where = await this.writeWhere(criteria, TenantContext.require());
    return where ? this.repository.delete(where) : { raw: [], affected: 0 };
  }

  /**
   * A select builder already limited to the tenant. The condition lives in
   * TypeORM's appended-AND slot, so `.where()` (which replaces earlier
   * wheres) and `.orWhere()` cannot widen it.
   */
  createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    const tenantId = TenantContext.require();
    const column =
      this.repository.metadata.findColumnWithPropertyName('tenantId');
    if (!column) {
      throw new Error(
        `${this.repository.metadata.name} has no tenantId column`,
      );
    }
    const builder = this.repository.createQueryBuilder(alias);
    builder.expressionMap.extraAppendedAndWhereCondition = `${builder.escape(
      alias,
    )}.${builder.escape(column.databaseName)} = :${TENANT_PARAMETER}`;
    return builder.setParameter(TENANT_PARAMETER, tenantId);
  }

  private scopeOptions<O extends FindManyOptions<T> | FindOneOptions<T>>(
    options: O,
  ): O {
    const tenantId = TenantContext.require();
    return {
      ...options,
      where: this.scopeWhere(options?.where as Where<T> | undefined, tenantId),
    } as O;
  }

  private scopeWhere(where: Where<T> | undefined, tenantId: string): Where<T> {
    if (where === undefined || where === null) {
      return { tenantId } as FindOptionsWhere<T>;
    }
    if (Array.isArray(where)) {
      return where.length === 0
        ? ({ tenantId } as FindOptionsWhere<T>)
        : where.map((one) => this.scopeOne(one, tenantId));
    }
    return this.scopeOne(where, tenantId);
  }

  private scopeOne(
    where: FindOptionsWhere<T>,
    tenantId: string,
  ): FindOptionsWhere<T> {
    if (!isWhereObject(where)) {
      throw new TypeError('A where condition must be an object');
    }
    assertSameTenant(where.tenantId, tenantId, 'Query');
    return { ...where, tenantId } as FindOptionsWhere<T>;
  }

  /**
   * The tenant-scoped where for update/delete/softDelete; null when an OR
   * criteria matches nothing. Empty criteria are refused, as TypeORM does.
   */
  private async writeWhere(
    criteria: WriteCriteria<T>,
    tenantId: string,
  ): Promise<FindOptionsWhere<T> | null> {
    if (
      criteria === undefined ||
      criteria === null ||
      criteria === '' ||
      (Array.isArray(criteria) && criteria.length === 0) ||
      (isWhereObject(criteria) && Object.keys(criteria).length === 0)
    ) {
      throw new Error('Empty criteria are not allowed for update/delete');
    }
    if (isIdValue(criteria)) {
      return {
        ...this.primaryWhere(criteria),
        tenantId,
      } as FindOptionsWhere<T>;
    }
    if (Array.isArray(criteria) && criteria.every(isIdValue)) {
      return {
        ...this.primaryWhere(In(criteria)),
        tenantId,
      } as FindOptionsWhere<T>;
    }
    if (Array.isArray(criteria)) {
      // TypeORM reads an array criteria as a list of ids and would drop the
      // tenantId of each object, so resolve the OR to ids first.
      return this.idsMatching(criteria as FindOptionsWhere<T>[], tenantId);
    }
    return this.scopeOne(criteria, tenantId);
  }

  private async idsMatching(
    criteria: FindOptionsWhere<T>[],
    tenantId: string,
  ): Promise<FindOptionsWhere<T> | null> {
    const primary = this.singlePrimaryColumn();
    const rows = await this.repository.find({
      select: { [primary]: true } as FindOptionsSelect<T>,
      where: criteria.map((one) => this.scopeOne(one, tenantId)),
      withDeleted: true,
    });
    if (rows.length === 0) {
      return null;
    }
    return {
      ...this.primaryWhere(In(rows.map((row) => row[primary]))),
      tenantId,
    } as FindOptionsWhere<T>;
  }

  /**
   * Relations stored in the tenant column (their join column is tenant_id):
   * TypeORM writes the related object's id there, ahead of `tenantId`.
   */
  private tenantRelations() {
    const metadata = this.repository.metadata;
    const column = metadata.findColumnWithPropertyName('tenantId');
    return (metadata.relations ?? []).filter((relation) =>
      relation.joinColumns?.some(
        (join) => join.databaseName === column?.databaseName,
      ),
    );
  }

  /** A tenant relation may be absent, null, or the context tenant only */
  private assertTenantRelations(
    values: ObjectLiteral | undefined,
    tenantId: string,
    what: string,
  ): void {
    if (!values) return;
    for (const relation of this.tenantRelations()) {
      const related = values[relation.propertyName];
      if (related === undefined || related === null) continue;
      const referenced = relation.joinColumns.find(
        (join) => join.referencedColumn,
      )?.referencedColumn;
      const value =
        typeof related === 'object' && referenced
          ? related[referenced.propertyName]
          : related;
      if (value !== tenantId) {
        throw new TenantMismatchError(what);
      }
    }
  }

  /** An existing row with the same id in another tenant must not be overwritten */
  private async assertNoForeignRows(
    entities: DeepPartial<T>[],
    tenantId: string,
  ): Promise<void> {
    const ids = entities
      .map((entity) => this.repository.metadata.getEntityIdMap(entity))
      .filter((id): id is ObjectLiteral => !!id);
    if (ids.length === 0) {
      return;
    }
    const foreign = await this.repository.find({
      where: ids.map(
        (id) => ({ ...id, tenantId: Not(tenantId) }) as FindOptionsWhere<T>,
      ),
      withDeleted: true,
      take: 1,
    });
    if (foreign.length > 0) {
      throw new TenantMismatchError('Entity id');
    }
  }

  private primaryWhere(value: unknown): ObjectLiteral {
    return { [this.singlePrimaryColumn()]: value };
  }

  private singlePrimaryColumn(): string {
    const columns = this.repository.metadata.primaryColumns;
    if (columns.length !== 1) {
      throw new Error(
        'Id criteria need exactly one primary column; pass a where object',
      );
    }
    return columns[0].propertyName;
  }
}
