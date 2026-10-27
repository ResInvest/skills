# ResInvest ERP 4 — obraz API (NestJS). Budowanie z katalogu głównego monorepo:
#   docker build -f apps/api/Dockerfile -t resinvest/api .
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json prisma.config.ts ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --filter @resinvest/api... --filter resinvest-erp-4
RUN pnpm --filter @resinvest/api run build
RUN pnpm --filter @resinvest/api deploy --prod --legacy /out && cp -r apps/api/dist /out/dist && cp -r apps/api/assets /out/assets

# Etap migracji: prisma migrate deploy (uruchamiany jako osobna usługa przed API)
FROM build AS migrate
WORKDIR /repo
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
