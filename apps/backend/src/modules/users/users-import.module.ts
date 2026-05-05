import { Module } from '@nestjs/common';
import { UsersImportController } from './users-import.controller';
import { TrpcModule } from '../../trpc/trpc.module';

@Module({
  imports: [TrpcModule],   // PrismaModule is @Global — PrismaService injected automatically
  controllers: [UsersImportController],
})
export class UsersImportModule {}
