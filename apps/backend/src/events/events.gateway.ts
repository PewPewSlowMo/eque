import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnModuleInit, Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';

const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];

@Injectable()
@WebSocketGateway({ cors: { origin: corsOrigins, credentials: true } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server!: Server;

  /** Карта: cabinetId → набор slug'ов табло, которые включают этот кабинет. */
  private boardCache: Map<string, Set<string>> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.refreshBoardCache();
    } catch (err) {
      console.warn('[EventsGateway] Failed to build board cache at startup; will rebuild on next DisplayBoard CRUD:', err);
    }
  }

  /**
   * Перестраивает кэш cabinet → boards. Вызывается из onModuleInit и
   * после CRUD-операций над DisplayBoard.
   */
  async refreshBoardCache(): Promise<void> {
    const boards = await this.prisma.displayBoard.findMany({
      select: {
        slug: true,
        cabinets: { select: { cabinetId: true } },
      },
    });
    const next: Map<string, Set<string>> = new Map();
    for (const b of boards) {
      for (const c of b.cabinets) {
        if (!next.has(c.cabinetId)) next.set(c.cabinetId, new Set());
        next.get(c.cabinetId)!.add(b.slug);
      }
    }
    this.boardCache = next;
  }

  /**
   * Принудительно отключает все сокеты в комнате `board:{slug}`.
   * Вызывается при удалении табло.
   */
  disconnectBoard(slug: string): void {
    const room = `board:${slug}`;
    const sockets = this.server.sockets.adapter.rooms.get(room);
    if (!sockets) return;
    for (const socketId of sockets) {
      const socket = this.server.sockets.sockets.get(socketId);
      socket?.disconnect(true);
    }
  }

  handleConnection(client: Socket) {
    console.log(`[WS] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[WS] Client disconnected: ${client.id}`);
  }

  /**
   * @deprecated Use typed emit methods (emitQueueUpdated, emitQueueCalled, emitAssignmentChanged).
   * Сохранён временно для роутеров, которые ещё не мигрированы.
   */
  emit(event: string, data: any) {
    this.server.emit(event, data);
  }

  /**
   * @deprecated Use emitQueueCalled with cabinet info.
   */
  emitToDoctor(doctorId: string, event: string, data: any) {
    this.server.to(`doctor:${doctorId}`).emit(event, data);
  }
}
