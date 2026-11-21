import { Module } from '@nestjs/common';
import { AuditWriter } from './audit-writer.service';

/** The audit log's write side; other modules (announcements) import this to call `AuditWriter.record` */
@Module({
  providers: [AuditWriter],
  exports: [AuditWriter],
})
export class AuditModule {}
