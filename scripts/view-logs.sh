#!/bin/bash
# 실시간 로그 확인 스크립트 (docker compose)
# 사용법:
#   ./scripts/view-logs.sh              # 전체
#   ./scripts/view-logs.sh khmer        # 크메르만
#   ./scripts/view-logs.sh vietnam      # 베트남만

cd "$(dirname "$0")/.." || exit 1

SERVICE=""
case "$1" in
  "" )
    SERVICE=""
    ;;
  khmer )
    SERVICE="lnteletranslate-khmer"
    ;;
  vietnam|viet )
    SERVICE="lnteletranslate-vietnam"
    ;;
  * )
    echo "사용법: $0 [khmer|vietnam]"
    exit 1
    ;;
esac

echo "=== 실시간 로그 모니터링 시작 (Ctrl+C로 종료) ==="
echo "프로젝트: $(pwd)"
echo ""

if [ -n "$SERVICE" ]; then
  docker compose logs -f "$SERVICE"
else
  docker compose logs -f
fi

