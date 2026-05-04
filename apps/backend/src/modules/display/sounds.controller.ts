import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Req,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { TrpcService } from '../../trpc/trpc.service';

@Controller('api/sounds')
export class SoundsController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: join(process.cwd(), 'public', 'sounds'),
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req, file, cb) => {
        if (/\.(mp3|wav|ogg)$/i.test(file.originalname)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Только .mp3, .wav, .ogg'), false);
        }
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadSound(@Req() req: any, @UploadedFile() file: Express.Multer.File) {
    const auth = req.headers.authorization as string | undefined;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    const user = TrpcService.verifyToken(auth.substring(7));
    if (!user || user.role !== 'ADMIN') throw new ForbiddenException('Только ADMIN');
    if (!file) throw new BadRequestException('Файл не загружен');
    return { soundUrl: `/sounds/${file.filename}` };
  }
}
