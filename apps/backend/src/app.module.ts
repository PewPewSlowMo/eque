import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [PrismaModule, TrpcModule, EventsModule],
})
export class AppModule {}
