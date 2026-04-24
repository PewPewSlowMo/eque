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
