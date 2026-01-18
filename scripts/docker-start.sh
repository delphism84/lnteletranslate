#!/bin/bash

# Docker로 번역 봇 시작 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR" || exit 1

echo "=== 번역 봇 Docker 시작 ==="
echo ""

echo "1. 빌드 + 기동 중..."
docker compose up -d --build

if [ $? -eq 0 ]; then
    echo "✅ 시작 완료"
else
    echo "❌ 시작 실패"
fi

echo ""
echo "=== 상태 확인 ==="
docker compose ps

echo ""
echo "로그 확인:"
echo "  docker compose logs -f"

