# Spec: Смена логина пользователя

**Дата:** 2026-05-29
**Статус:** Approved
**Scope:** Backend + Frontend (Admin UI)

---

## Контекст

Форма редактирования пользователя позволяет менять пароль, ФИО и другие атрибуты, но не логин. Это создаёт неудобство при опечатках или кадровых изменениях. Требуется добавить возможность смены логина только для ADMIN.

---

## Требования

- ADMIN может изменить логин любого пользователя через форму редактирования
- Логин должен быть уникальным; при дублировании — понятная ошибка
- Поле опциональное: если не изменено — не передаётся на backend
- Минимальная длина логина: 3 символа (как при создании)
- Смена логина не прерывает активные сессии пользователя

---

## Влияние на сессии

Активные сессии не ломаются: backend авторизует по `userId` из JWT, а не по `username`. Пользователь с изменённым логином продолжает работать до logout или истечения токена (7 дней). После — обязан входить с новым логином. Старый логин перестаёт работать для входа немедленно.

В UI у этого пользователя будет отображаться старый логин (из `localStorage['auth_user']`) до следующего входа. Это приемлемо — смена логина редкая операция, только через ADMIN.

---

## Backend

**Файл:** `apps/backend/src/modules/users/users.router.ts`

Изменение в процедуре `update`:

```typescript
// Добавить в input schema:
username: z.string().min(3).optional(),

// Обернуть prisma.user.update в try/catch:
try {
  return await prisma.user.update({ ... });
} catch (e: any) {
  if (e.code === 'P2002' && e.meta?.target?.includes('username')) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Логин уже занят' });
  }
  throw e;
}
```

`username` уже попадает в `data` через `...rest` — отдельной обработки не требуется.

---

## Frontend

**Файл:** `apps/frontend/src/components/admin/UserDialog.tsx`

В режиме `isEdit` добавить поле "Логин" в левую колонку, над полем "Новый пароль":

```tsx
{isEdit && (
  <div className="space-y-1">
    <Label>Логин</Label>
    <Input
      value={username}
      onChange={(e) => setUsername(e.target.value)}
      placeholder={editUser?.username}
    />
  </div>
)}
```

В `handleSubmit` при `isEdit` добавить условную передачу:

```typescript
...(username.trim() && username.trim() !== editUser?.username
  ? { username: username.trim() }
  : {}),
```

Клиентская валидация: если поле заполнено и изменено — проверить `username.trim().length >= 3`, иначе `toast.error`.

State `username` уже объявлен и инициализируется из `editUser?.username ?? ''` — существующий код не меняется.

---

## Что не меняется

- JWT-механика и `auth.login`
- `UserContext` и `localStorage`
- Логика авторизации на backend (`trpc.service.ts`)
- Процедуры `create`, `getAll`, `getDoctors`, `importBatch`

---

## Тест-сценарии (ручные)

1. ADMIN меняет логин пользователя → сохраняется, в списке отображается новый логин
2. ADMIN вводит уже занятый логин → toast "Логин уже занят"
3. ADMIN вводит логин < 3 символов → toast об ошибке
4. ADMIN оставляет поле логина без изменений → update проходит без username в payload
5. Пользователь X залогинен, ADMIN меняет его логин → X продолжает работать
6. X делает logout → может войти только с новым логином
7. X пробует войти со старым логином → UNAUTHORIZED
