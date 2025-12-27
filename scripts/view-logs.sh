#!/bin/bash
# 실시간 로그 확인 스크립트
# 사용법: ./scripts/view-logs.sh

cd "$(dirname "$0")/.." || exit 1

if [ ! -f "app.log" ]; then
    echo "[로그] app.log 파일이 없습니다. 애플리케이션이 로그 파일로 실행되고 있는지 확인하세요."
    exit 1
fi

echo "=== 실시간 로그 모니터링 시작 (Ctrl+C로 종료) ==="
echo "로그 파일: $(pwd)/app.log"
echo ""

tail -f app.log

