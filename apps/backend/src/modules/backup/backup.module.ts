import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BackupController],
})
export class BackupModule {}
