#!/bin/bash

# Docker로 번역 봇 중지 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR" || exit 1

echo "=== 번역 봇 Docker 중지 ==="
echo ""

# 크메르어 봇 중지
echo "1. 크메르어 봇 중지 중..."
docker compose -f docker-compose.khmer.yml down

if [ $? -eq 0 ]; then
    echo "✅ 크메르어 봇 중지 완료"
else
    echo "❌ 크메르어 봇 중지 실패"
fi

echo ""

# 베트남어 봇 중지
echo "2. 베트남어 봇 중지 중..."
docker compose -f docker-compose.vietnam.yml down

if [ $? -eq 0 ]; then
    echo "✅ 베트남어 봇 중지 완료"
else
    echo "❌ 베트남어 봇 중지 실패"
fi

