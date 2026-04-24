# СЭО Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать работающий монорепозиторий с полной инфраструктурой, схемой БД, аутентификацией и базовыми CRUD-модулями (отделения, кабинеты, пользователи, пациенты).

**Architecture:** Отдельный репо `eque` — точная копия структуры `hospital-erp`: pnpm-монорепо, Turborepo, `apps/backend` (NestJS + tRPC + Prisma), `apps/frontend` (React + Vite + Tailwind). Каждый модуль бэкенда — функция `createXxxRouter(trpc, prisma, eventsGateway?)`.

**Tech Stack:** Node.js ≥22, pnpm 9.15, Turborepo, NestJS 10, tRPC 11, Prisma 6, PostgreSQL 17, Redis 7, Socket.io 4, React 18, Vite 6, Tailwind 3, Radix UI, TypeScript 5.

**Phases:**
- **Phase 1 (этот план):** Foundation — инфраструктура, схема, auth, CRUD справочников
- **Phase 2:** Queue Engine — движок очереди, приоритеты, назначение кабинетов, WebSocket
- **Phase 3:** Registrar UI — интерфейс регистратора
- **Phase 4:** Doctor UI — интерфейс врача
- **Phase 5:** Department Head UI — дашборд заведующего
- **Phase 6:** Display Board — публичное табло
- **Phase 7:** Admin Panel — управление пользователями и справочниками

---

## File Structure (Phase 1)

```
eque/
├── CLAUDE.md
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── docker-compose.yml
├── .env.example
├── .gitignore
├── apps/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   ├── Dockerfile
│   │   ├── prisma/
│   │   │   ├── schema.prisma          ← все модели домена
│   │   │   └── seed.ts                ← начальные данные
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── trpc/
│   │       │   ├── trpc.service.ts    ← JWT, protectedProcedure
│   │       │   ├── trpc.module.ts
│   │       │   ├── trpc.router.ts     ← корневой роутер
│   │       │   └── trpc.controller.ts
│   │       ├── database/
│   │       │   ├── prisma.service.ts
│   │       │   └── prisma.module.ts
│   │       ├── events/
│   │       │   ├── events.gateway.ts
│   │       │   └── events.module.ts
│   │       └── modules/
│   │           ├── auth/
│   │           │   └── auth.router.ts
│   │           ├── users/
│   │           │   └── users.router.ts
│   │           ├── departments/
│   │           │   └── departments.router.ts
│   │           ├── cabinets/
│   │           │   └── cabinets.router.ts
│   │           └── patients/
│   │               └── patients.router.ts
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       ├── index.html
│       ├── Dockerfile
│       └── src/
│           ├── main.tsx
│           ├── App.tsx                ← кастомный роутер + auth gate
│           ├── lib/
│           │   ├── trpc.ts            ← tRPC client
│           │   └── socket.ts          ← Socket.io client
│           ├── contexts/
│           │   └── UserContext.tsx
│           └── components/
│               ├── Login.tsx
│               ├── Layout.tsx
│               └── ui/               ← Radix UI компоненты
└── packages/
    └── shared/
        ├── package.json
        └── src/
            └── index.ts
```

---

## Task 1: Инициализация репозитория

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `CLAUDE.md`

- [ ] **Step 1.1: Инициализировать git и подключить remote**

```bash
cd /home/administrator/projects_danik
git init
git remote add origin https://github.com/PewPewSlowMo/eque.git
```

- [ ] **Step 1.2: Создать `package.json`**

```json
{
  "name": "eque",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "dev:frontend": "pnpm --filter frontend dev",
    "dev:backend": "pnpm --filter backend dev",
    "build": "turbo run build",
    "db:migrate": "pnpm --filter backend prisma migrate dev",
    "db:migrate:prod": "pnpm --filter backend prisma migrate deploy",
    "db:seed": "pnpm --filter backend prisma db seed",
    "db:studio": "pnpm --filter backend prisma studio",
    "db:reset": "pnpm --filter backend prisma migrate reset",
    "generate": "pnpm --filter backend prisma generate"
  },
  "devDependencies": {
    "prettier": "^3.3.3",
    "turbo": "^2.3.0"
  },
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "packageManager": "pnpm@9.15.0"
}
```

- [ ] **Step 1.3: Создать `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 1.4: Создать `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    }
  }
}
```

- [ ] **Step 1.5: Создать `.gitignore`**

```
node_modules
dist
build
.env
.env.local
.turbo
*.log
coverage
```

- [ ] **Step 1.6: Создать `CLAUDE.md`**

```markdown
# eque — Система Электронной Очереди

## Правила работы с репозиторием

### Git
- После каждого изменения делай коммит с понятным описанием
- Формат коммита: тип(область): описание на русском
  - feat: новая функция
  - fix: исправление бага
  - refactor: рефакторинг
  - docs: документация
- Перед коммитом всегда делай git add -A
- После коммита делай git push

### Примеры коммитов
- feat(auth): добавлена авторизация через JWT
- fix(queue): исправлен порядок приоритетов
- docs(readme): обновлена инструкция по установке

## Архитектура

Монорепозиторий: pnpm + Turborepo.
- `apps/backend` — NestJS + tRPC + Prisma
- `apps/frontend` — React + Vite + Tailwind
- `packages/shared` — общие типы

Каждый модуль бэкенда: `createXxxRouter(trpc, prisma, eventsGateway?)` в файле `xxx.router.ts`.
```

- [ ] **Step 1.7: Первый коммит**

```bash
git add -A
git commit -m "feat(repo): инициализация монорепозитория eque"
git push -u origin main
```

---

## Task 2: Shared Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 2.1: Создать `packages/shared/package.json`**

```json
{
  "name": "@eque/shared",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "scripts": {
    "build": "echo 'shared has no build step'"
  }
}
```

- [ ] **Step 2.2: Создать `packages/shared/src/index.ts`**

```typescript
// Общие типы и константы для frontend и backend
export const QUEUE_PRIORITY_LABELS: Record<string, string> = {
  EMERGENCY: 'Экстренный',
  INPATIENT: 'Стационарный',
  SCHEDULED: 'Записанный',
  WALK_IN: 'Живая очередь',
};

export const PATIENT_CATEGORY_LABELS: Record<string, string> = {
  PAID_ONCE: 'Платный (разовый)',
  PAID_CONTRACT: 'Платный (договор)',
  OSMS: 'ОСМС',
  CONTINGENT: 'Контингент',
  EMPLOYEE: 'Сотрудник',
};

export const USER_ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  REGISTRAR: 'Регистратор',
  CALL_CENTER: 'Колл-центр',
  DOCTOR: 'Врач',
  DEPARTMENT_HEAD: 'Заведующий отделением',
  DIRECTOR: 'Руководитель',
};
```

- [ ] **Step 2.3: Коммит**

```bash
git add -A
git commit -m "feat(shared): добавлен shared-пакет с общими метками"
git push
```

---

## Task 3: Backend — скаффолдинг

**Files:**
- Create: `apps/backend/package.json`
- Create: `apps/backend/tsconfig.json`
- Create: `apps/backend/nest-cli.json`

- [ ] **Step 3.1: Создать `apps/backend/package.json`**

```json
{
  "name": "backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start:prod": "node dist/main",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "ts-node prisma/seed.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/platform-socket.io": "^10.0.0",
    "@nestjs/websockets": "^10.0.0",
    "@prisma/client": "^6.1.0",
    "@trpc/server": "^11.7.2",
    "bcrypt": "^5.1.1",
    "body-parser": "^1.20.3",
    "jsonwebtoken": "^9.0.2",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "socket.io": "^4.8.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@types/bcrypt": "^5.0.2",
    "@types/express": "^5.0.6",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^22.10.2",
    "prisma": "^6.1.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 3.2: Создать `apps/backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": false,
    "noImplicitAny": false,
    "strictBindCallApply": false,
    "forceConsistentCasingInFileNames": false,
    "noFallthroughCasesInSwitch": false
  }
}
```

- [ ] **Step 3.3: Создать `apps/backend/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 3.4: Коммит**

```bash
git add -A
git commit -m "feat(backend): конфигурация NestJS-приложения"
git push
```

---

## Task 4: Prisma Schema

**Files:**
- Create: `apps/backend/prisma/schema.prisma`

- [ ] **Step 4.1: Создать `apps/backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================================
// ENUMS
// ============================================================================

enum UserRole {
  ADMIN
  REGISTRAR
  CALL_CENTER
  DOCTOR
  DEPARTMENT_HEAD
  DIRECTOR
}

enum PatientCategory {
  PAID_ONCE
  PAID_CONTRACT
  OSMS
  CONTINGENT
  EMPLOYEE
}

enum QueuePriority {
  EMERGENCY
  INPATIENT
  SCHEDULED
  WALK_IN
}

enum QueueEntryStatus {
  WAITING_ARRIVAL
  ARRIVED
  CALLED
  IN_PROGRESS
  COMPLETED
  NO_SHOW
  CANCELLED
}

enum QueueSource {
  REGISTRAR
  CALL_CENTER
}

// ============================================================================
// USERS
// ============================================================================

model User {
  id         String   @id @default(cuid())
  username   String   @unique
  password   String
  firstName  String
  lastName   String
  middleName String?
  role       UserRole @default(REGISTRAR)
  isActive   Boolean  @default(true)
  specialty  String?

  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id])

  // Категории, доступные регистратору / колл-центру для постановки в очередь
  allowedCategories PatientCategory[]

  createdQueueEntries QueueEntry[]       @relation("CreatedBy")
  doctorQueueEntries  QueueEntry[]       @relation("DoctorQueue")
  assignments         DoctorAssignment[] @relation("AssignedDoctor")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

// ============================================================================
// DEPARTMENTS & CABINETS
// ============================================================================

model Department {
  id       String  @id @default(cuid())
  name     String
  isActive Boolean @default(true)

  users    User[]
  cabinets Cabinet[]
  patients Patient[]  @relation("EmployeeDepartment")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("departments")
}

model Cabinet {
  id           String  @id @default(cuid())
  number       String  @unique
  name         String?
  departmentId String?
  department   Department? @relation(fields: [departmentId], references: [id])
  isActive     Boolean @default(true)

  assignments DoctorAssignment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("cabinets")
}

// ============================================================================
// DOCTOR ↔ CABINET ASSIGNMENTS
// ============================================================================

model DoctorAssignment {
  id        String   @id @default(cuid())
  doctorId  String
  doctor    User     @relation("AssignedDoctor", fields: [doctorId], references: [id])
  cabinetId String
  cabinet   Cabinet  @relation(fields: [cabinetId], references: [id])

  startTime DateTime
  endTime   DateTime?
  isActive  Boolean  @default(true)

  shiftTemplateId String?
  shiftTemplate   ShiftTemplate? @relation(fields: [shiftTemplateId], references: [id])

  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([doctorId, isActive])
  @@index([cabinetId, isActive])
  @@map("doctor_assignments")
}

model ShiftTemplate {
  id        String @id @default(cuid())
  name      String
  startTime String // "08:00"
  endTime   String // "14:00"

  assignments DoctorAssignment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("shift_templates")
}

// ============================================================================
// PATIENTS
// ============================================================================

model Patient {
  id          String  @id @default(cuid())
  firstName   String
  lastName    String
  middleName  String?
  dateOfBirth DateTime?
  phone       String?
  iin         String?  @unique

  categories       PatientCategory[]
  contractNumber   String?

  employeeDepartmentId String?
  employeeDepartment   Department? @relation("EmployeeDepartment", fields: [employeeDepartmentId], references: [id])

  queueEntries QueueEntry[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([lastName, firstName])
  @@map("patients")
}

// ============================================================================
// QUEUE
// ============================================================================

model QueueEntry {
  id          String           @id @default(cuid())
  queueNumber Int

  // Очередь привязана к врачу, НЕ к кабинету
  doctorId  String
  doctor    User    @relation("DoctorQueue", fields: [doctorId], references: [id])
  patientId String
  patient   Patient @relation(fields: [patientId], references: [id])

  priority QueuePriority
  category PatientCategory

  scheduledAt DateTime? // для SCHEDULED: плановое время

  requiresArrivalConfirmation Boolean @default(true)

  status    QueueEntryStatus @default(WAITING_ARRIVAL)
  source    QueueSource
  createdById String
  createdBy   User    @relation("CreatedBy", fields: [createdById], references: [id])

  paymentConfirmed Boolean @default(false)
  notes            String?
  cancelReason     String?

  arrivedAt   DateTime?
  calledAt    DateTime?
  completedAt DateTime?

  history QueueHistory[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([doctorId, createdAt, queueNumber])
  @@index([doctorId, status])
  @@map("queue_entries")
}

model QueueHistory {
  id           String           @id @default(cuid())
  queueEntryId String
  queueEntry   QueueEntry       @relation(fields: [queueEntryId], references: [id])
  action       String
  oldStatus    QueueEntryStatus?
  newStatus    QueueEntryStatus?
  userId       String?
  notes        String?
  createdAt    DateTime         @default(now())

  @@index([queueEntryId])
  @@map("queue_history")
}

// ============================================================================
// SYSTEM SETTINGS
// ============================================================================

model CategorySettings {
  id                          String          @id @default(cuid())
  category                    PatientCategory @unique
  requiresArrivalConfirmation Boolean         @default(true)
  requiresPaymentConfirmation Boolean         @default(false)

  updatedAt DateTime @updatedAt

  @@map("category_settings")
}
```

- [ ] **Step 4.2: Установить зависимости backend**

```bash
cd /home/administrator/projects_danik
pnpm install
```

- [ ] **Step 4.3: Проверить схему**

```bash
pnpm --filter backend prisma validate
```

Ожидаемый вывод: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 4.4: Коммит**

```bash
git add -A
git commit -m "feat(db): добавлена Prisma-схема с моделями домена СЭО"
git push
```

---

## Task 5: Docker и окружение

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `apps/backend/Dockerfile`
- Create: `apps/frontend/Dockerfile`

- [ ] **Step 5.1: Создать `.env.example`**

```bash
# База данных
DATABASE_URL="postgresql://eque_admin:eque_dev_password@localhost:5432/eque?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# Backend
PORT=3001
HOST=0.0.0.0
NODE_ENV=development
JWT_SECRET=change-me-in-production-32-chars-min
CORS_ORIGIN=http://localhost:3000

# Frontend
VITE_TRPC_URL=http://localhost:3001/trpc
VITE_WS_URL=http://localhost:3001
```

- [ ] **Step 5.2: Создать `.env` из примера**

```bash
cp .env.example .env
```

- [ ] **Step 5.3: Создать `docker-compose.yml`**

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:17-alpine
    container_name: eque-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: eque_admin
      POSTGRES_PASSWORD: eque_dev_password
      POSTGRES_DB: eque
      POSTGRES_INITDB_ARGS: "--encoding=UTF-8 --lc-collate=ru_RU.UTF-8 --lc-ctype=ru_RU.UTF-8"
    ports:
      - "5433:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U eque_admin -d eque"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - eque-network

  redis:
    image: redis:7-alpine
    container_name: eque-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    ports:
      - "6380:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - eque-network

  backend:
    build:
      context: .
      dockerfile: ./apps/backend/Dockerfile
      target: development
    container_name: eque-backend
    restart: unless-stopped
    ports:
      - "3002:3001"
    environment:
      DATABASE_URL: "postgresql://eque_admin:eque_dev_password@postgres:5432/eque?schema=public"
      REDIS_URL: "redis://redis:6379"
      PORT: "3001"
      HOST: "0.0.0.0"
      NODE_ENV: "development"
      JWT_SECRET: "change-me-in-production-32-chars-min"
      CORS_ORIGIN: "http://localhost:3000,http://localhost:5173"
    volumes:
      - ./apps/backend:/app/apps/backend
      - /app/node_modules
      - /app/apps/backend/node_modules
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - eque-network

  frontend:
    build:
      context: .
      dockerfile: ./apps/frontend/Dockerfile
      target: development
    container_name: eque-frontend
    restart: unless-stopped
    ports:
      - "3000:5173"
    environment:
      VITE_TRPC_URL: "http://backend:3001/trpc"
      VITE_WS_URL: "http://backend:3001"
      NODE_ENV: "development"
    volumes:
      - ./apps/frontend:/app/apps/frontend
      - /app/node_modules
      - /app/apps/frontend/node_modules
    depends_on:
      - backend
    networks:
      - eque-network

  adminer:
    image: adminer:latest
    container_name: eque-adminer
    restart: unless-stopped
    ports:
      - "8081:8080"
    networks:
      - eque-network
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:

networks:
  eque-network:
    driver: bridge
```

- [ ] **Step 5.4: Создать `apps/backend/Dockerfile`**

```dockerfile
FROM node:22-alpine AS development

WORKDIR /app

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/ ./packages/

RUN pnpm install

COPY apps/backend ./apps/backend

WORKDIR /app/apps/backend

RUN npx prisma generate

EXPOSE 3001

CMD ["pnpm", "dev"]
```

- [ ] **Step 5.5: Создать `apps/frontend/Dockerfile`**

```dockerfile
FROM node:22-alpine AS development

WORKDIR /app

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-workspace.yaml ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/ ./packages/

RUN pnpm install

COPY apps/frontend ./apps/frontend

WORKDIR /app/apps/frontend

EXPOSE 5173

CMD ["pnpm", "dev"]
```

- [ ] **Step 5.6: Запустить инфраструктуру и проверить**

```bash
docker compose up postgres redis -d
docker compose logs postgres | tail -5
```

Ожидаемый вывод: `database system is ready to accept connections`

- [ ] **Step 5.7: Выполнить первую миграцию**

```bash
pnpm --filter backend prisma migrate dev --name init
```

Ожидаемый вывод: `Your database is now in sync with your schema.`

- [ ] **Step 5.8: Коммит**

```bash
git add -A
git commit -m "feat(infra): добавлен Docker Compose, Dockerfile для backend и frontend"
git push
```

---

## Task 6: Backend — ядро NestJS

**Files:**
- Create: `apps/backend/src/main.ts`
- Create: `apps/backend/src/app.module.ts`
- Create: `apps/backend/src/database/prisma.service.ts`
- Create: `apps/backend/src/database/prisma.module.ts`
- Create: `apps/backend/src/events/events.gateway.ts`
- Create: `apps/backend/src/events/events.module.ts`
- Create: `apps/backend/src/trpc/trpc.service.ts`
- Create: `apps/backend/src/trpc/trpc.module.ts`
- Create: `apps/backend/src/trpc/trpc.router.ts`

- [ ] **Step 6.1: Создать `apps/backend/src/database/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
    this.$on('error', (e: any) => this.logger.error('Prisma error:', e));
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async connectWithRetry(maxRetries = 5, delay = 3000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.$connect();
        this.logger.log('✅ Database connected');
        return;
      } catch (error) {
        this.logger.error(`Connection attempt ${attempt}/${maxRetries} failed`);
        if (attempt === maxRetries) throw error;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
```

- [ ] **Step 6.2: Создать `apps/backend/src/database/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6.3: Создать `apps/backend/src/events/events.gateway.ts`**

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];

@WebSocketGateway({ cors: { origin: corsOrigins, credentials: true } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`[WS] Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[WS] Client disconnected: ${client.id}`);
  }

  emit(event: string, data: any) {
    this.server.emit(event, data);
  }

  // Эмит только клиентам, подписанным на конкретного врача
  emitToDoctor(doctorId: string, event: string, data: any) {
    this.server.to(`doctor:${doctorId}`).emit(event, data);
  }
}
```

- [ ] **Step 6.4: Создать `apps/backend/src/events/events.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
```

- [ ] **Step 6.5: Создать `apps/backend/src/trpc/trpc.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { PrismaService } from '../database/prisma.service';
import { UserRole } from '@prisma/client';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-32-chars-min';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  departmentId?: string | null;
}

export interface Context {
  prisma: PrismaService;
  user?: AuthUser;
}

@Injectable()
export class TrpcService {
  trpc = initTRPC.context<Context>().create();

  procedure = this.trpc.procedure;

  protectedProcedure = this.trpc.procedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Требуется авторизация' });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });

  router = this.trpc.router;

  static verifyToken(token: string): AuthUser | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      return {
        id: decoded.userId,
        username: decoded.username,
        role: decoded.role,
        departmentId: decoded.departmentId,
      };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 6.6: Создать `apps/backend/src/trpc/trpc.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TrpcService } from './trpc.service';
import { TrpcRouter } from './trpc.router';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [EventsModule],
  providers: [TrpcService, TrpcRouter],
  exports: [TrpcService],
})
export class TrpcModule {}
```

- [ ] **Step 6.7: Создать `apps/backend/src/trpc/trpc.router.ts`**

```typescript
import { INestApplication, Injectable } from '@nestjs/common';
import * as trpcExpress from '@trpc/server/adapters/express';
import { TrpcService } from './trpc.service';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { createAuthRouter } from '../modules/auth/auth.router';
import { createUsersRouter } from '../modules/users/users.router';
import { createDepartmentsRouter } from '../modules/departments/departments.router';
import { createCabinetsRouter } from '../modules/cabinets/cabinets.router';
import { createPatientsRouter } from '../modules/patients/patients.router';

@Injectable()
export class TrpcRouter {
  constructor(
    private readonly trpc: TrpcService,
    private readonly prisma: PrismaService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  appRouter = this.trpc.router({
    health: this.trpc.procedure.query(() => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })),
    auth: createAuthRouter(this.trpc, this.prisma),
    users: createUsersRouter(this.trpc, this.prisma),
    departments: createDepartmentsRouter(this.trpc, this.prisma),
    cabinets: createCabinetsRouter(this.trpc, this.prisma),
    patients: createPatientsRouter(this.trpc, this.prisma),
  });

  async applyMiddleware(app: INestApplication) {
    app.use(
      '/trpc',
      trpcExpress.createExpressMiddleware({
        router: this.appRouter,
        createContext: ({ req }: { req: any }) => {
          let user = undefined;
          const authHeader = req.headers.authorization;
          if (authHeader?.startsWith('Bearer ')) {
            user = TrpcService.verifyToken(authHeader.substring(7)) ?? undefined;
          }
          return { prisma: this.prisma, user };
        },
      }),
    );
  }
}

export type AppRouter = TrpcRouter['appRouter'];
```

- [ ] **Step 6.8: Создать `apps/backend/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma.module';
import { TrpcModule } from './trpc/trpc.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [PrismaModule, TrpcModule, EventsModule],
})
export class AppModule {}
```

- [ ] **Step 6.9: Создать `apps/backend/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TrpcRouter } from './trpc/trpc.router';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const corsOrigins = process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  const trpc = app.get(TrpcRouter);
  await trpc.applyMiddleware(app);

  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  console.log(`🚀 Backend: http://localhost:${port}`);
  console.log(`🔗 tRPC: http://localhost:${port}/trpc`);
}

bootstrap();
```

- [ ] **Step 6.10: Проверить запуск backend**

```bash
pnpm --filter backend dev
```

Ожидаемый вывод: `🚀 Backend: http://localhost:3001`

- [ ] **Step 6.11: Проверить health endpoint**

```bash
curl http://localhost:3001/trpc/health
```

Ожидаемый вывод: `{"result":{"data":{"status":"ok","timestamp":"..."}}}`

- [ ] **Step 6.12: Коммит**

```bash
git add -A
git commit -m "feat(backend): ядро NestJS с tRPC, Prisma, Socket.io"
git push
```

---

## Task 7: Auth модуль

**Files:**
- Create: `apps/backend/src/modules/auth/auth.router.ts`

- [ ] **Step 7.1: Создать `apps/backend/src/modules/auth/auth.router.ts`**

```typescript
import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-32-chars-min';
const JWT_EXPIRES_IN = '7d';

export const createAuthRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    login: trpc.procedure
      .input(z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const user = await prisma.user.findUnique({
          where: { username: input.username },
          include: { department: { select: { id: true, name: true } } },
        });

        if (!user || !user.isActive) {
          throw new Error('Неверный логин или пароль');
        }

        const valid = await bcrypt.compare(input.password, user.password);
        if (!valid) throw new Error('Неверный логин или пароль');

        const token = jwt.sign(
          { userId: user.id, username: user.username, role: user.role, departmentId: user.departmentId },
          JWT_SECRET,
          { expiresIn: JWT_EXPIRES_IN },
        );

        return {
          token,
          user: {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            middleName: user.middleName,
            role: user.role,
            departmentId: user.departmentId,
            department: user.department,
            allowedCategories: user.allowedCategories,
          },
        };
      }),

    me: trpc.protectedProcedure.query(async ({ ctx }) => {
      const user = await prisma.user.findUnique({
        where: { id: ctx.user.id },
        include: { department: { select: { id: true, name: true } } },
      });
      if (!user) throw new Error('Пользователь не найден');
      return {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        middleName: user.middleName,
        role: user.role,
        departmentId: user.departmentId,
        department: user.department,
        allowedCategories: user.allowedCategories,
      };
    }),
  });
};
```

- [ ] **Step 7.2: Коммит**

```bash
git add -A
git commit -m "feat(auth): добавлен модуль авторизации JWT"
git push
```

---

## Task 8: Справочные модули (departments, cabinets, users)

**Files:**
- Create: `apps/backend/src/modules/departments/departments.router.ts`
- Create: `apps/backend/src/modules/cabinets/cabinets.router.ts`
- Create: `apps/backend/src/modules/users/users.router.ts`

- [ ] **Step 8.1: Создать `apps/backend/src/modules/departments/departments.router.ts`**

```typescript
import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createDepartmentsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async () => {
      return prisma.department.findMany({
        where: { isActive: true },
        include: { _count: { select: { users: true, cabinets: true } } },
        orderBy: { name: 'asc' },
      });
    }),

    create: trpc.protectedProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        return prisma.department.create({ data: { name: input.name } });
      }),

    update: trpc.protectedProcedure
      .input(z.object({ id: z.string(), name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        return prisma.department.update({ where: { id: input.id }, data: { name: input.name } });
      }),

    deactivate: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        return prisma.department.update({ where: { id: input.id }, data: { isActive: false } });
      }),
  });
};
```

- [ ] **Step 8.2: Создать `apps/backend/src/modules/cabinets/cabinets.router.ts`**

```typescript
import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';

export const createCabinetsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async () => {
      return prisma.cabinet.findMany({
        where: { isActive: true },
        include: { department: { select: { id: true, name: true } } },
        orderBy: { number: 'asc' },
      });
    }),

    create: trpc.protectedProcedure
      .input(z.object({
        number: z.string().min(1),
        name: z.string().optional(),
        departmentId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        return prisma.cabinet.create({ data: input });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id: z.string(),
        number: z.string().min(1).optional(),
        name: z.string().optional(),
        departmentId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        const { id, ...data } = input;
        return prisma.cabinet.update({ where: { id }, data });
      }),

    deactivate: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        return prisma.cabinet.update({ where: { id: input.id }, data: { isActive: false } });
      }),
  });
};
```

- [ ] **Step 8.3: Создать `apps/backend/src/modules/users/users.router.ts`**

```typescript
import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { UserRole, PatientCategory } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const createUsersRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    getAll: trpc.protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
      return prisma.user.findMany({
        include: { department: { select: { id: true, name: true } } },
        orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
      });
    }),

    create: trpc.protectedProcedure
      .input(z.object({
        username: z.string().min(3),
        password: z.string().min(6),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        middleName: z.string().optional(),
        role: z.nativeEnum(UserRole),
        specialty: z.string().optional(),
        departmentId: z.string().optional(),
        allowedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        const hashed = await bcrypt.hash(input.password, 10);
        return prisma.user.create({
          data: { ...input, password: hashed, allowedCategories: input.allowedCategories ?? [] },
          include: { department: { select: { id: true, name: true } } },
        });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id: z.string(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        middleName: z.string().optional(),
        specialty: z.string().optional(),
        departmentId: z.string().optional(),
        allowedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(6).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== 'ADMIN') throw new Error('Нет доступа');
        const { id, password, ...rest } = input;
        const data: any = { ...rest };
        if (password) data.password = await bcrypt.hash(password, 10);
        return prisma.user.update({
          where: { id },
          data,
          include: { department: { select: { id: true, name: true } } },
        });
      }),

    getDoctors: trpc.protectedProcedure
      .input(z.object({ departmentId: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return prisma.user.findMany({
          where: {
            role: { in: ['DOCTOR', 'DEPARTMENT_HEAD'] },
            isActive: true,
            ...(input?.departmentId ? { departmentId: input.departmentId } : {}),
          },
          include: { department: { select: { id: true, name: true } } },
          orderBy: { lastName: 'asc' },
        });
      }),
  });
};
```

- [ ] **Step 8.4: Коммит**

```bash
git add -A
git commit -m "feat(backend): модули departments, cabinets, users"
git push
```

---

## Task 9: Patients модуль

**Files:**
- Create: `apps/backend/src/modules/patients/patients.router.ts`

- [ ] **Step 9.1: Создать `apps/backend/src/modules/patients/patients.router.ts`**

```typescript
import { z } from 'zod';
import { TrpcService } from '../../trpc/trpc.service';
import { PrismaService } from '../../database/prisma.service';
import { PatientCategory } from '@prisma/client';

export const createPatientsRouter = (trpc: TrpcService, prisma: PrismaService) => {
  return trpc.router({
    search: trpc.protectedProcedure
      .input(z.object({ query: z.string().min(1) }))
      .query(async ({ input }) => {
        const q = input.query.trim();
        return prisma.patient.findMany({
          where: {
            OR: [
              { lastName: { contains: q, mode: 'insensitive' } },
              { firstName: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { iin: { contains: q } },
            ],
          },
          take: 20,
          orderBy: { lastName: 'asc' },
        });
      }),

    getById: trpc.protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return prisma.patient.findUnique({ where: { id: input.id } });
      }),

    create: trpc.protectedProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        middleName: z.string().optional(),
        dateOfBirth: z.string().datetime().optional(),
        phone: z.string().optional(),
        iin: z.string().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).default([]),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { dateOfBirth, ...rest } = input;
        return prisma.patient.create({
          data: {
            ...rest,
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          },
        });
      }),

    update: trpc.protectedProcedure
      .input(z.object({
        id: z.string(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        middleName: z.string().optional(),
        phone: z.string().optional(),
        iin: z.string().optional(),
        categories: z.array(z.nativeEnum(PatientCategory)).optional(),
        contractNumber: z.string().optional(),
        employeeDepartmentId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        return prisma.patient.update({ where: { id }, data });
      }),
  });
};
```

- [ ] **Step 9.2: Коммит**

```bash
git add -A
git commit -m "feat(backend): модуль patients с поиском"
git push
```

---

## Task 10: Seed данные

**Files:**
- Create: `apps/backend/prisma/seed.ts`

- [ ] **Step 10.1: Создать `apps/backend/prisma/seed.ts`**

```typescript
import { PrismaClient, UserRole, PatientCategory } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Сброс и наполнение базы данных...');

  await prisma.queueHistory.deleteMany();
  await prisma.queueEntry.deleteMany();
  await prisma.doctorAssignment.deleteMany();
  await prisma.shiftTemplate.deleteMany();
  await prisma.categorySettings.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.user.deleteMany();
  await prisma.cabinet.deleteMany();
  await prisma.department.deleteMany();

  // Departments
  const [therapy, surgery, cardiology] = await Promise.all([
    prisma.department.create({ data: { id: 'dep-1', name: 'Терапевтическое отделение' } }),
    prisma.department.create({ data: { id: 'dep-2', name: 'Хирургическое отделение' } }),
    prisma.department.create({ data: { id: 'dep-3', name: 'Кардиологическое отделение' } }),
  ]);
  console.log('✅ Отделения созданы');

  // Cabinets
  await prisma.cabinet.createMany({
    data: [
      { number: '101', name: 'Кабинет терапевта 1', departmentId: therapy.id },
      { number: '102', name: 'Кабинет терапевта 2', departmentId: therapy.id },
      { number: '201', name: 'Кабинет хирурга', departmentId: surgery.id },
      { number: '301', name: 'Кабинет кардиолога', departmentId: cardiology.id },
    ],
  });
  console.log('✅ Кабинеты созданы');

  const hash = async (p: string) => bcrypt.hash(p, 10);

  // Users
  await prisma.user.createMany({
    data: [
      {
        username: 'admin',
        password: await hash('admin123'),
        firstName: 'Администратор',
        lastName: 'Системы',
        role: UserRole.ADMIN,
        allowedCategories: [],
      },
      {
        username: 'registrar1',
        password: await hash('reg123'),
        firstName: 'Анна',
        lastName: 'Регистратова',
        role: UserRole.REGISTRAR,
        allowedCategories: [PatientCategory.OSMS, PatientCategory.CONTINGENT, PatientCategory.PAID_ONCE],
      },
      {
        username: 'head1',
        password: await hash('head123'),
        firstName: 'Иван',
        lastName: 'Заведующий',
        role: UserRole.DEPARTMENT_HEAD,
        departmentId: therapy.id,
        allowedCategories: [],
      },
      {
        username: 'doctor1',
        password: await hash('doc123'),
        firstName: 'Мария',
        lastName: 'Терапевтова',
        role: UserRole.DOCTOR,
        specialty: 'Терапевт',
        departmentId: therapy.id,
        allowedCategories: [],
      },
      {
        username: 'doctor2',
        password: await hash('doc123'),
        firstName: 'Сергей',
        lastName: 'Хирургов',
        role: UserRole.DOCTOR,
        specialty: 'Хирург',
        departmentId: surgery.id,
        allowedCategories: [],
      },
    ],
  });
  console.log('✅ Пользователи созданы');

  // CategorySettings (defaults)
  await prisma.categorySettings.createMany({
    data: [
      { category: PatientCategory.PAID_ONCE, requiresArrivalConfirmation: true, requiresPaymentConfirmation: true },
      { category: PatientCategory.PAID_CONTRACT, requiresArrivalConfirmation: true, requiresPaymentConfirmation: false },
      { category: PatientCategory.OSMS, requiresArrivalConfirmation: true, requiresPaymentConfirmation: false },
      { category: PatientCategory.CONTINGENT, requiresArrivalConfirmation: true, requiresPaymentConfirmation: false },
      { category: PatientCategory.EMPLOYEE, requiresArrivalConfirmation: false, requiresPaymentConfirmation: false },
    ],
  });
  console.log('✅ Настройки категорий созданы');

  // Shift templates
  await prisma.shiftTemplate.createMany({
    data: [
      { name: 'Утренняя смена', startTime: '08:00', endTime: '14:00' },
      { name: 'Дневная смена', startTime: '14:00', endTime: '20:00' },
      { name: 'Полный день', startTime: '08:00', endTime: '17:00' },
    ],
  });
  console.log('✅ Шаблоны смен созданы');

  // Test patients
  await prisma.patient.createMany({
    data: [
      { firstName: 'Иван', lastName: 'Иванов', middleName: 'Иванович', phone: '+7-701-111-1111', categories: [PatientCategory.OSMS] },
      { firstName: 'Мария', lastName: 'Петрова', middleName: 'Сергеевна', phone: '+7-701-222-2222', categories: [PatientCategory.PAID_CONTRACT], contractNumber: 'ДГ-2024-001' },
      { firstName: 'Алексей', lastName: 'Сидоров', phone: '+7-701-333-3333', categories: [PatientCategory.CONTINGENT] },
    ],
  });
  console.log('✅ Тестовые пациенты созданы');

  console.log('\n🎉 Seed завершён!');
  console.log('Логины: admin/admin123 | registrar1/reg123 | head1/head123 | doctor1/doc123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 10.2: Добавить секцию `prisma.seed` в `apps/backend/package.json`**

В файл `apps/backend/package.json` добавить поле `prisma` на верхний уровень (рядом с `scripts`):

```json
{
  "name": "backend",
  ...
  "scripts": { ... },
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  },
  "dependencies": { ... }
}
```

- [ ] **Step 10.3: Запустить seed**

```bash
pnpm --filter backend prisma db seed
```

Ожидаемый вывод: `🎉 Seed завершён!`

- [ ] **Step 10.4: Проверить login через tRPC**

```bash
curl -X POST http://localhost:3001/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"json":{"username":"admin","password":"admin123"}}'
```

Ожидаемый вывод: JSON с полем `token`

- [ ] **Step 10.5: Коммит**

```bash
git add -A
git commit -m "feat(seed): начальные данные — отделения, кабинеты, пользователи, настройки"
git push
```

---

## Task 11: Frontend — скаффолдинг

**Files:**
- Create: `apps/frontend/package.json`
- Create: `apps/frontend/vite.config.ts`
- Create: `apps/frontend/tailwind.config.js`
- Create: `apps/frontend/index.html`
- Create: `apps/frontend/src/main.tsx`
- Create: `apps/frontend/src/lib/trpc.ts`
- Create: `apps/frontend/src/contexts/UserContext.tsx`
- Create: `apps/frontend/src/App.tsx`
- Create: `apps/frontend/src/components/Login.tsx`
- Create: `apps/frontend/src/components/Layout.tsx`

- [ ] **Step 11.1: Создать `apps/frontend/package.json`**

```json
{
  "name": "frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite --host 0.0.0.0 --port 5173",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@eque/shared": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.6",
    "@radix-ui/react-dropdown-menu": "^2.1.6",
    "@radix-ui/react-label": "^2.1.2",
    "@radix-ui/react-select": "^2.1.6",
    "@radix-ui/react-separator": "^1.1.2",
    "@radix-ui/react-slot": "^1.1.2",
    "@radix-ui/react-tabs": "^1.1.3",
    "@radix-ui/react-toast": "^1.2.6",
    "@tanstack/react-query": "^5.90.11",
    "@trpc/client": "^11.7.2",
    "@trpc/react-query": "^11.7.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.487.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.55.0",
    "socket.io-client": "^4.8.1",
    "sonner": "^2.0.7",
    "tailwind-merge": "^2.5.4",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.1",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vite": "^6.3.5"
  }
}
```

- [ ] **Step 11.2: Создать `apps/frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["src"]
}
```

- [ ] **Step 11.3: Создать `apps/frontend/postcss.config.js`**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 11.4: Создать `apps/frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
```

- [ ] **Step 11.5: Создать `apps/frontend/tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 11.6: Создать `apps/frontend/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>СЭО — Электронная очередь</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 11.6: Создать `apps/frontend/src/main.tsx`**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { trpc, trpcClient } from './lib/trpc';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>,
);
```

- [ ] **Step 11.7: Создать `apps/frontend/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 11.8: Создать `apps/frontend/src/lib/trpc.ts`**

```typescript
import { createTRPCReact } from '@trpc/react-query';
import { httpLink } from '@trpc/client';
import type { AppRouter } from '../../../backend/src/trpc/trpc.router';

export const trpc = createTRPCReact<AppRouter>();

export const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: import.meta.env.VITE_TRPC_URL || 'http://localhost:3001/trpc',
      async headers() {
        const token = localStorage.getItem('auth_token');
        return { authorization: token ? `Bearer ${token}` : '' };
      },
    }),
  ],
});
```

- [ ] **Step 11.9: Создать `apps/frontend/src/contexts/UserContext.tsx`**

```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';
import { trpc } from '../lib/trpc';

interface AuthUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  role: string;
  departmentId?: string;
  department?: { id: string; name: string } | null;
  allowedCategories: string[];
}

interface UserContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasToken = !!localStorage.getItem('auth_token');

  // TanStack Query v5: callbacks removed from useQuery — используем useEffect
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: hasToken,
    retry: false,
  });

  useEffect(() => {
    if (!hasToken) {
      setIsLoading(false);
      return;
    }
    if (meQuery.isSuccess) {
      setUser(meQuery.data as AuthUser);
      setIsLoading(false);
    }
    if (meQuery.isError) {
      localStorage.removeItem('auth_token');
      setUser(null);
      setIsLoading(false);
    }
  }, [meQuery.isSuccess, meQuery.isError, meQuery.data, hasToken]);

  const login = (token: string, userData: AuthUser) => {
    localStorage.setItem('auth_token', token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setUser(null);
  };

  return (
    <UserContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
```

- [ ] **Step 11.10: Создать `apps/frontend/src/App.tsx`**

```typescript
import React, { useState } from 'react';
import { UserProvider, useUser } from './contexts/UserContext';
import { Login } from './components/Login';
import { Layout } from './components/Layout';

function AppContent() {
  const { user, isLoading } = useUser();
  const [currentPath, setCurrentPath] = useState('/');

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">Загрузка...</p>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Layout currentPath={currentPath} onNavigate={setCurrentPath}>
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Добро пожаловать, {user.firstName} {user.lastName}
        </h1>
        <p className="mt-1 text-gray-500">Роль: {user.role}</p>
      </div>
    </Layout>
  );
}

export function App() {
  return (
    <UserProvider>
      <AppContent />
    </UserProvider>
  );
}
```

- [ ] **Step 11.11: Создать `apps/frontend/src/components/Login.tsx`**

```typescript
import React, { useState } from 'react';
import { trpc } from '../lib/trpc';
import { useUser } from '../contexts/UserContext';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useUser();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => login(data.token, data.user as any),
    onError: (e) => setError(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    loginMutation.mutate({ username, password });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">СЭО — Вход</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Логин</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loginMutation.isLoading}
            className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loginMutation.isLoading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 11.12: Создать `apps/frontend/src/components/Layout.tsx`**

```typescript
import React from 'react';
import { useUser } from '../contexts/UserContext';

const NAV_ITEMS: Record<string, { path: string; label: string }[]> = {
  ADMIN: [
    { path: '/', label: 'Главная' },
    { path: '/admin/users', label: 'Пользователи' },
    { path: '/admin/departments', label: 'Отделения' },
    { path: '/admin/cabinets', label: 'Кабинеты' },
  ],
  REGISTRAR: [
    { path: '/', label: 'Главная' },
    { path: '/registrar', label: 'Регистратура' },
  ],
  DOCTOR: [
    { path: '/', label: 'Главная' },
    { path: '/doctor', label: 'Моя очередь' },
  ],
  DEPARTMENT_HEAD: [
    { path: '/', label: 'Главная' },
    { path: '/head', label: 'Отделение' },
  ],
  DIRECTOR: [
    { path: '/', label: 'Главная' },
    { path: '/director', label: 'Дашборд' },
  ],
  CALL_CENTER: [
    { path: '/', label: 'Главная' },
    { path: '/callcenter', label: 'Запись' },
  ],
};

interface LayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}

export function Layout({ currentPath, onNavigate, children }: LayoutProps) {
  const { user, logout } = useUser();
  const navItems = NAV_ITEMS[user?.role ?? ''] ?? [];

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-60 bg-white shadow-sm">
        <div className="p-4 border-b">
          <p className="font-bold text-blue-700 text-lg">СЭО</p>
          <p className="text-xs text-gray-500 truncate">{user?.lastName} {user?.firstName}</p>
        </div>
        <nav className="p-2">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm mb-1 transition-colors ${
                currentPath === item.path
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-0 w-60 p-4 border-t">
          <button onClick={logout} className="w-full text-sm text-gray-500 hover:text-red-600">
            Выйти
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 11.13: Запустить frontend и проверить**

```bash
pnpm --filter frontend dev
```

Открыть http://localhost:5173, войти как `admin / admin123`. Должна появиться страница с именем пользователя и ролью.

- [ ] **Step 11.14: Коммит**

```bash
git add -A
git commit -m "feat(frontend): скаффолдинг React-приложения с авторизацией"
git push
```

---

## Результат Phase 1

После выполнения всех задач:

- ✅ Монорепозиторий с pnpm + Turborepo
- ✅ Docker Compose с PostgreSQL, Redis, Backend, Frontend, Adminer
- ✅ Prisma-схема с полным доменом СЭО
- ✅ NestJS + tRPC backend с JWT-авторизацией
- ✅ Модули: auth, users, departments, cabinets, patients
- ✅ Seed с тестовыми данными (5 ролей, 4 кабинета, 3 отделения)
- ✅ React frontend с авторизацией, роль-based навигацией
- ✅ CLAUDE.md с git-правилами

**Следующий план:** `2026-04-24-eque-phase2-queue-engine.md`
- Движок очереди (приоритеты, статусная машина)
- Модуль назначения кабинетов (DoctorAssignment)
- WebSocket события для real-time обновлений
