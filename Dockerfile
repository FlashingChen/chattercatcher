# ---- 构建阶段 ----
FROM node:20-bookworm AS build
WORKDIR /app

# 先复制清单文件，充分利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ---- 运行阶段 ----
# better-sqlite3 是原生模块，使用 bookworm 系镜像避免编译坑
FROM node:20-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV CHATTERCATCHER_HOME=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 3878

ENTRYPOINT ["node", "dist/cli.js"]
