# eque — Система Электронной Очереди

Система управления электронной очередью для медицинских учреждений.

## Документация

📖 [Архитектурная документация (Wiki)](./CLAUDE_wiki_export.md) — полное описание проекта для нового разработчика: архитектура, бизнес-логика, инфраструктура, паттерны, известные проблемы.

## Быстрый старт

```bash
# Запустить все сервисы
docker-compose up -d

# Наполнить тестовыми данными (только первый раз)
docker exec eque-backend sh -c "cd /app && pnpm --filter backend prisma db seed"
```

Открыть в браузере: `http://localhost:3003`

**Тестовые логины:** `admin/admin123` · `registrar1/reg123` · `head1/head123` · `doctor1/doc123`

## Стек

- **Backend:** NestJS + tRPC + Prisma + PostgreSQL
- **Frontend:** React + Vite + Tailwind CSS
- **Real-time:** Socket.IO
- **Инфраструктура:** Docker + docker-compose
