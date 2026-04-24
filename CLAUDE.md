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
