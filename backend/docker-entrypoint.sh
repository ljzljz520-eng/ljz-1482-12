#!/bin/sh
set -e

echo "⏳ 等待数据库 ${DATABASE_HOST:-db}:${DATABASE_PORT:-5432} ..."
until node -e "
const net = require('net');
const s = net.connect({ host: process.env.DATABASE_HOST || 'db', port: Number(process.env.DATABASE_PORT || 5432) });
s.on('connect', () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
" 2>/dev/null; do
  sleep 1
done
echo "✅ 数据库可达"

echo "🔄 同步 Prisma schema (db push) ..."
npx prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss

echo "🌱 执行 seed ..."
npx tsx prisma/seed.ts

echo "🚀 启动后端服务 ..."
exec npx tsx src/server.ts
