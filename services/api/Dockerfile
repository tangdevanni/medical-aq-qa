FROM node:20-bullseye-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/api ./services/api
COPY services/finale-workbook-intake ./services/finale-workbook-intake
COPY services/portal-worker ./services/portal-worker

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medical-ai-qa/api... build

EXPOSE 3000

CMD ["node", "services/api/dist/services/api/src/index.js"]
