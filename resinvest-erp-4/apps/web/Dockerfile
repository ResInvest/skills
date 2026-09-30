# ResInvest ERP 4 — frontend (build Vite) serwowany przez Nginx z TLS.
#   docker build -f apps/web/Dockerfile -t resinvest/web .
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @resinvest/web... --filter resinvest-erp-4
RUN pnpm --filter @resinvest/web run build

FROM nginx:1.28-alpine
COPY deploy/nginx/resinvest.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/riw-proxy.inc /etc/nginx/conf.d/riw-proxy.inc
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80 443
