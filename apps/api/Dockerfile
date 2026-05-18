FROM node:20-alpine
RUN npm install -g pnpm@9
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm install --frozen-lockfile --shamefully-hoist
RUN pnpm --filter "./packages/shared" run build
RUN pnpm --filter "./packages/db" run build
RUN pnpm --filter "./apps/api" run build
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
