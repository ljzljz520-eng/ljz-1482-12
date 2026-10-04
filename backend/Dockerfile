FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install

# 先拷 schema 生成 client
COPY prisma ./prisma
RUN npx prisma generate

COPY . .

ENV NODE_ENV=production
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
