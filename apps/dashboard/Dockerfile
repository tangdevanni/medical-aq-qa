FROM node:20-bullseye-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @medical-ai-qa/dashboard... build

EXPOSE 3001

CMD ["pnpm", "--filter", "@medical-ai-qa/dashboard", "start"]
