import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';
import { SoundsModule } from './modules/display/sounds.module';
import { UsersImportModule } from './modules/users/users-import.module';
import { SchedulesImportModule } from './modules/schedules/schedules-import.module';

@Module({
  imports: [PrismaModule, TrpcModule, EventsModule, SoundsModule, UsersImportModule, SchedulesImportModule],
})
export class AppModule {}
