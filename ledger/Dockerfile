FROM node:20-alpine

WORKDIR /app

# 한국 시간 기준으로 날짜(occurred_at, 이번달 집계)를 계산한다.
RUN apk add --no-cache tzdata
ENV TZ=Asia/Seoul

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

CMD ["node", "src/index.js"]
