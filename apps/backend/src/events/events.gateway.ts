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

  private getBoardRoomsForCabinet(cabinetId: string | null | undefined): string[] {
    if (!cabinetId) return [];
    const slugs = this.boardCache.get(cabinetId);
    if (!slugs) return [];
    return Array.from(slugs).map((slug) => `board:${slug}`);
  }

  private getStaffRoomsFor(args: { doctorId: string; departmentId: string | null }): string[] {
    const rooms = ['staff:all', `doctor:${args.doctorId}`];
    if (args.departmentId) rooms.push(`department:${args.departmentId}`);
    return rooms;
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
    const staffRooms = this.getStaffRoomsFor(args);

    this.server.to(staffRooms).emit('queue:updated', staffPayload);
    // queue:updated может выстреливать без cabinetId (создание записи, confirmArrival и т.д.).
    // Шлём всем табло в общую `board:all` — табло сами рефетчат свой scope через display.getBySlug.
    // Payload пустой — board просто триггерит refetch.
    this.server.to('board:all').emit('queue:updated', {});
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

    const staffRooms = this.getStaffRoomsFor(args);
    const boardRooms = this.getBoardRoomsForCabinet(args.cabinetId);

    this.server.to(staffRooms).emit('queue:called', staffPayload);
    if (boardRooms.length > 0) {
      this.server.to(boardRooms).emit('queue:called', boardPayload);
    }
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
    const staffRooms = this.getStaffRoomsFor(args);
    this.server.to(staffRooms).emit(args.type, staffPayload);
    // assignment меняет cabinet doctor'а → табло могут перестать/начать показывать врача.
    // Шлём в board:all с пустым payload, табло рефетчат display.getBySlug и пересчитывают свой scope.
    this.server.to('board:all').emit(args.type, {});
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
