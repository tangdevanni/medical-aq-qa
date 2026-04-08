FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.6.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/finale-workbook-intake ./services/finale-workbook-intake

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medical-ai-qa/finale-workbook-intake build

WORKDIR /app/services/finale-workbook-intake

CMD ["node", "dist/services/finale-workbook-intake/src/testing/run-oasis-demo.js"]