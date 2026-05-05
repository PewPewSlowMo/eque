import { Module } from '@nestjs/common';
import { SchedulesImportController } from './schedules-import.controller';
import { TrpcModule } from '../../trpc/trpc.module';

@Module({
  imports: [TrpcModule],   // PrismaModule is @Global — PrismaService injected automatically
  controllers: [SchedulesImportController],
})
export class SchedulesImportModule {}
