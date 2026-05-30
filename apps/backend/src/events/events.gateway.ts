import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnModuleInit, Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';
import type { StaffEvent, BoardCallEvent } from './event-types';

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
   * Сигнал "очередь у врача изменилась" — staff-клиенты делают refetch через tRPC.
   * Board-клиенты получают сигнал refresh для `display.getBySlug`.
   */
  emitQueueUpdated(args: {
    doctorId: string;
    departmentId: string | null;
    entryId: string;
    cabinetId?: string | null;
  }): void {
    const staffPayload: StaffEvent = {
      type: 'queue:updated',
      doctorId: args.doctorId,
      departmentId: args.departmentId,
      entryId: args.entryId,
      cabinetId: args.cabinetId ?? null,
    };
    // Phase 4 (Task 6): switch to room-based routing. For now broadcast.
    this.server.emit('queue:updated', staffPayload);
  }

  /**
   * Сигнал "пациент вызван" — staff-клиенты делают refetch, board-клиенты получают
   * замаскированный payload для немедленного TTS.
   */
  emitQueueCalled(args: {
    doctorId: string;
    departmentId: string | null;
    cabinetId: string;
    cabinetNumber: string;
    entry: {
      id: string;
      queueNumber: number;
      displayConsent: boolean;
      patient: {
        firstName: string;
        lastName: string;
        middleName: string | null;
      };
    };
  }): void {
    const staffPayload: StaffEvent = {
      type: 'queue:called',
      doctorId: args.doctorId,
      departmentId: args.departmentId,
      entryId: args.entry.id,
      cabinetId: args.cabinetId,
    };

    const noConsent = args.entry.displayConsent === false;
    const boardPayload: BoardCallEvent = {
      cabinetId: args.cabinetId,
      cabinetNumber: args.cabinetNumber,
      queueNumber: args.entry.queueNumber,
      patientFirstName:  noConsent ? null : args.entry.patient.firstName,
      patientLastName:   noConsent ? null : args.entry.patient.lastName,
      patientMiddleName: noConsent ? ''   : (args.entry.patient.middleName ?? ''),
    };

    // Phase 4 (Task 6): switch to two separate room-targeted emits.
    // For now, broadcast staffPayload only — board still reads legacy `data.entry.patient.*`
    // until Task 7 updates the client. To avoid breaking the client in this transitional
    // commit, we keep broadcasting BOTH the new staffPayload AND the legacy payload.
    this.server.emit('queue:called', { ...staffPayload, ...boardPayload });
  }

  /**
   * Сигнал "назначение врач↔кабинет создано/завершено".
   */
  emitAssignmentChanged(args: {
    type: 'assignment:created' | 'assignment:ended';
    doctorId: string;
    departmentId: string | null;
    cabinetId: string | null;
  }): void {
    const staffPayload: StaffEvent = {
      type: args.type,
      doctorId: args.doctorId,
      departmentId: args.departmentId,
      cabinetId: args.cabinetId,
    };
    // Phase 4 (Task 6): switch to room-based.
    this.server.emit(args.type, staffPayload);
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
