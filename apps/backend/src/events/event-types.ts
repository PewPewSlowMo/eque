// apps/backend/src/events/event-types.ts

export type StaffEventType =
  | 'queue:updated'
  | 'queue:called'
  | 'assignment:created'
  | 'assignment:ended';

/**
 * Payload для staff-комнат (`staff:all`, `department:*`, `doctor:*`).
 * НЕ содержит PII пациента. Клиент использует как trigger для refetch через tRPC.
 */
export interface StaffEvent {
  type: StaffEventType;
  doctorId: string;
  departmentId: string | null;
  entryId?: string;
  cabinetId?: string | null;
}

/**
 * Payload для board-комнат (`board:{slug}`).
 * Содержит ФИО ТОЛЬКО если у пациента `displayConsent=true`.
 * Сервер маскирует ДО отправки — клиент уже не решает.
 */
export interface BoardCallEvent {
  cabinetId: string;
  cabinetNumber: string;
  queueNumber: number;
  patientFirstName: string | null;  // null если displayConsent=false
  patientLastName: string | null;
  patientMiddleName: string;        // '' если displayConsent=false (для совместимости с TTS template)
}
