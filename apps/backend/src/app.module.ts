import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';
import { SoundsModule } from './modules/display/sounds.module';

@Module({
  imports: [PrismaModule, TrpcModule, EventsModule, SoundsModule],
})
export class AppModule {}
