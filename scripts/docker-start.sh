#!/bin/bash

# Docker로 번역 봇 시작 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR" || exit 1

echo "=== 번역 봇 Docker 시작 ==="
echo ""

# 크메르어 봇 시작
echo "1. 크메르어 봇 시작 중..."
docker compose -f docker-compose.khmer.yml up -d

if [ $? -eq 0 ]; then
    echo "✅ 크메르어 봇 시작 완료"
else
    echo "❌ 크메르어 봇 시작 실패"
fi

echo ""

# 베트남어 봇 시작
echo "2. 베트남어 봇 시작 중..."
docker compose -f docker-compose.vietnam.yml up -d

if [ $? -eq 0 ]; then
    echo "✅ 베트남어 봇 시작 완료"
else
    echo "❌ 베트남어 봇 시작 실패"
fi

echo ""
echo "=== 상태 확인 ==="
docker compose -f docker-compose.khmer.yml ps
docker compose -f docker-compose.vietnam.yml ps

echo ""
echo "로그 확인:"
echo "  크메르어: docker compose -f docker-compose.khmer.yml logs -f"
echo "  베트남어: docker compose -f docker-compose.vietnam.yml logs -f"

