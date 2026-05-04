import { Module } from '@nestjs/common';
import { SoundsController } from './sounds.controller';
import { TrpcModule } from '../../trpc/trpc.module';

@Module({
  imports: [TrpcModule],
  controllers: [SoundsController],
})
export class SoundsModule {}
