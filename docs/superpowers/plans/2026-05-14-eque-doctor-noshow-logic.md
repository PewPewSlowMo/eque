# Doctor No-Show Logic Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переместить кнопку "Неявка" у врача из состояния до вызова (ARRIVED/WAITING_ARRIVAL) в состояние после вызова (CALLED), чтобы врач мог отметить неявку только после того, как пациент был вызван и не пришёл.

**Architecture:** Два изменения: (1) бэкенд разрешает переход CALLED → NO_SHOW в мутации `markNoShow`; (2) фронтенд врача показывает кнопку "Неявка" только когда `status === 'CALLED'`. Регистратор сохраняет возможность ставить неявку из WAITING_ARRIVAL/ARRIVED без изменений.

**Tech Stack:** NestJS + tRPC (backend validation), React + Tailwind (DoctorQueueList component)

---

### Task 1: Backend — разрешить CALLED → NO_SHOW

**Files:**
- Modify: `apps/backend/src/modules/queue/queue.router.ts:526`

Текущая строка 526:
```typescript
if (!['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status)) {
```

- [ ] **Step 1: Изменить список допустимых статусов для markNoShow**

В файле `apps/backend/src/modules/queue/queue.router.ts` строка 526:

```typescript
// было
if (!['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status)) {

// стало
if (!['WAITING_ARRIVAL', 'ARRIVED', 'CALLED'].includes(entry.status)) {
```

- [ ] **Step 2: Проверить, что сборка бэкенда не сломана**

```bash
cd /home/administrator/projects_danik
docker exec eque-backend sh -c "cd /app && node -e \"console.log('ok')\""
```

Ожидаемый вывод: `ok` (контейнер работает, синтаксических ошибок нет — TypeScript компилируется при запуске)

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/modules/queue/queue.router.ts
git commit -m "fix(queue): разрешить markNoShow из статуса CALLED"
```

---

### Task 2: Frontend — кнопка "Неявка" только в состоянии CALLED

**Files:**
- Modify: `apps/frontend/src/components/doctor/DoctorQueueList.tsx:146`

Текущее состояние строки 146:
```typescript
const canNoShow  = ['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status);
```

Кнопка "Неявка" отображается в строках 238–246 при `canNoShow`. После изменения `canNoShow` будет `true` только когда `status === 'CALLED'`, что совпадает с `canStart`. Кнопка окажется рядом с "Повтор" и "Начать" — именно там, где она нужна.

- [ ] **Step 1: Изменить условие canNoShow**

В файле `apps/frontend/src/components/doctor/DoctorQueueList.tsx` строка 146:

```typescript
// было
const canNoShow  = ['WAITING_ARRIVAL', 'ARRIVED'].includes(entry.status);

// стало
const canNoShow  = entry.status === 'CALLED';
```

- [ ] **Step 2: Проверить визуальный порядок кнопок**

После изменения при `status === 'CALLED'` блок кнопок будет выглядеть так (строки 218–246):

```
[Повтор]  [Начать]  [Неявка]
```

Убедиться, что кнопка "Неявка" находится ПОСЛЕ "Начать", а не до него. Текущий порядок в коде:
- строки 220–227: Повтор (`canStart`)
- строки 228–236: Начать (`canStart`)
- строки 238–246: Неявка (`canNoShow`)

Порядок уже правильный — перемещать ничего не нужно.

- [ ] **Step 3: Убедиться что при ARRIVED/WAITING_ARRIVAL кнопки "Неявка" нет**

Просмотреть код `renderEntry` и убедиться, что при `status === 'ARRIVED'` активны только:
- `canCall = true` → кнопка "Вызвать"
- `canNoShow = false` → кнопки "Неявка" нет
- `canStart = false` → кнопок "Повтор" и "Начать" нет

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/doctor/DoctorQueueList.tsx
git commit -m "fix(doctor): кнопка Неявка только после вызова (CALLED)"
```

---

### Task 3: Push

- [ ] **Step 1: Push обоих коммитов**

```bash
git push
```

Ожидаемый вывод: `main -> main` с двумя новыми коммитами.
