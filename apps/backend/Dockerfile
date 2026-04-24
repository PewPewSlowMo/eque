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
