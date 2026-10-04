FROM node:20-alpine
WORKDIR /app
RUN npm config set registry https://registry.npmmirror.com
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
EXPOSE 3001
# 先执行数据库迁移（drizzle 版本化 SQL），再启动 API 服务
CMD ["sh", "-c", "npx drizzle-kit migrate && node --import tsx src/index.ts"]
