# Username Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Позволить ADMIN менять логин пользователя через форму редактирования с проверкой уникальности.

**Architecture:** Два изменения — backend добавляет `username` в `update` input и ловит P2002; frontend добавляет поле "Логин" в форму редактирования и условно передаёт его при изменении. Активные сессии пользователя не прерываются (backend авторизует по `userId`).

**Tech Stack:** NestJS + tRPC + Prisma (backend), React + tRPC client (frontend), Zod (валидация).

---

## Файлы

- Modify: `apps/backend/src/modules/users/users.router.ts` — добавить `username` в update input, добавить try/catch P2002
- Modify: `apps/frontend/src/components/admin/UserDialog.tsx` — добавить поле логина в isEdit-режим

---

### Task 1: Backend — username в update + обработка дублирования

**Files:**
- Modify: `apps/backend/src/modules/users/users.router.ts:49-87`

- [ ] **Step 1: Добавить `username` в input schema процедуры `update`**

Найди блок `update: trpc.protectedProcedure` (строка ~49). В `.input(z.object({...}))` добавь поле `username` после `id`:

```typescript
update: trpc.protectedProcedure
  .input(z.object({
    id: z.string(),
    username: z.string().min(3).optional(),   // ← добавить эту строку
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    middleName: z.string().optional(),
    specialty: z.string().optional(),
    departmentId: z.string().optional(),
    allowedCategories:  z.array(z.nativeEnum(PatientCategory)).optional(),
    acceptedCategories: z.array(z.nativeEnum(PatientCategory)).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(6).optional(),
    selfRegister: z.boolean().optional(),
  }))
```

- [ ] **Step 2: Обернуть `prisma.user.update` в try/catch**

Найди строку `return prisma.user.update({` в мутации `update` (строка ~81). Замени прямой вызов на:

```typescript
        try {
          return await prisma.user.update({
            where: { id },
            data,
            omit: { password: true },
            include: { department: { select: { id: true, name: true } } },
          });
        } catch (e: any) {
          if (e.code === 'P2002' && (e.meta?.target as string[] | undefined)?.includes('username')) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Логин уже занят' });
          }
          throw e;
        }
```

Обрати внимание: `username` уже попадёт в `data` через `const { id, password, ...rest } = input` + `const data: any = { ...rest }` — отдельной обработки не нужно.

- [ ] **Step 3: Проверить, что backend компилируется без ошибок**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -30
```

Ожидание: нет ошибок, связанных с `users.router.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/modules/users/users.router.ts
git commit -m "feat(users): добавить смену логина в update + обработка дублирования P2002"
```

---

### Task 2: Frontend — поле логина в форме редактирования

**Files:**
- Modify: `apps/frontend/src/components/admin/UserDialog.tsx`

- [ ] **Step 1: Добавить поле "Логин" в isEdit-блок**

Найди блок `isEdit` в JSX (строка ~213):

```tsx
            ) : (
              <div className="space-y-1">
                <Label>Новый пароль</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Не менять"
                />
              </div>
            )}
```

Замени на блок с двумя полями в сетке (логин + пароль), по аналогии с режимом создания:

```tsx
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Логин</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Мин. 3 символа"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Новый пароль</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Не менять"
                  />
                </div>
              </div>
            )}
```

State `username` уже объявлен и инициализируется из `editUser?.username ?? ''` в `useEffect` — ничего добавлять не нужно.

- [ ] **Step 2: Добавить клиентскую валидацию и передачу username в update.mutate**

Найди `handleSubmit` (строка ~146). После проверки `!firstName.trim() || !lastName.trim()` добавь:

```typescript
    if (isEdit && username.trim() && username.trim().length < 3) {
      toast.error('Логин должен содержать минимум 3 символа');
      return;
    }
```

Затем в блоке `if (isEdit)` найди вызов `update.mutate({...})` (строка ~156) и добавь условную передачу `username`:

```typescript
      update.mutate({
        id: editUser!.id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || undefined,
        specialty: specialty.trim() || undefined,
        departmentId: (departmentId && departmentId !== NONE_DEPT) ? departmentId : undefined,
        allowedCategories:  allowedCategories as any,
        acceptedCategories: acceptedCategories as any,
        selfRegister,
        ...(username.trim() && username.trim() !== editUser!.username
          ? { username: username.trim() }
          : {}),
        ...(password.trim() ? { password: password.trim() } : {}),
      });
```

- [ ] **Step 3: Проверить, что frontend компилируется без ошибок**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | head -30
```

Ожидание: нет ошибок, связанных с `UserDialog.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/components/admin/UserDialog.tsx
git commit -m "feat(users): поле смены логина в форме редактирования пользователя"
```

---

### Task 3: Ручная проверка (e2e)

- [ ] **Step 1: Убедиться, что backend и frontend запущены**

```bash
docker compose ps
```

Ожидание: `eque-backend` и `eque-frontend` — `Up`.

- [ ] **Step 2: Сценарий — успешная смена логина**

1. Войти как ADMIN
2. Открыть раздел пользователей → выбрать любого пользователя (не себя) → "Редактировать"
3. Поле "Логин" должно показывать текущий логин
4. Изменить логин на новое уникальное значение (≥ 3 символа) → "Сохранить"
5. Ожидание: toast "Пользователь обновлён", в списке отображается новый логин

- [ ] **Step 3: Сценарий — дублирующий логин**

1. Открыть форму редактирования любого пользователя
2. Ввести логин уже существующего пользователя → "Сохранить"
3. Ожидание: toast "Логин уже занят"

- [ ] **Step 4: Сценарий — логин < 3 символов**

1. Открыть форму редактирования
2. Ввести "ab" (2 символа) → "Сохранить"
3. Ожидание: toast "Логин должен содержать минимум 3 символа"

- [ ] **Step 5: Сценарий — поле не изменено**

1. Открыть форму редактирования, ничего не менять в поле логина → "Сохранить" (изменить, например, имя)
2. Ожидание: запрос проходит без `username` в payload, обновление успешно

- [ ] **Step 6: Сценарий — сессия не прерывается**

1. Открыть браузер A — залогиниться как пользователь X
2. В браузере B (ADMIN) — изменить логин X
3. В браузере A — выполнить любое действие (перейти на страницу)
4. Ожидание: браузер A продолжает работать без ошибок авторизации
5. В браузере A — разлогиниться, попробовать войти со старым логином
6. Ожидание: ошибка "Неверный логин или пароль"
7. В браузере A — войти с новым логином
8. Ожидание: успешный вход
