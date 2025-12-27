#!/bin/bash

# 인증서 자동 갱신 cron 설정 스크립트
# 사용법: sudo ./scripts/setup-cron.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENEW_SCRIPT="$SCRIPT_DIR/renew-ssl.sh"

echo "[Cron Setup] 인증서 자동 갱신 cron 설정 중..."

# renew-ssl.sh 실행 권한 확인
if [ ! -x "$RENEW_SCRIPT" ]; then
    chmod +x "$RENEW_SCRIPT"
fi

# cron 작업 추가 (매일 새벽 3시에 실행)
CRON_JOB="0 3 * * * $RENEW_SCRIPT >> /var/log/lnteletranslate-ssl-renew.log 2>&1"

# 기존 cron 작업 확인
if crontab -l 2>/dev/null | grep -q "$RENEW_SCRIPT"; then
    echo "[Cron Setup] 이미 cron 작업이 등록되어 있습니다."
    echo "[Cron Setup] 기존 작업:"
    crontab -l | grep "$RENEW_SCRIPT"
else
    # cron 작업 추가
    (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
    echo "[Cron Setup] cron 작업이 추가되었습니다."
    echo "[Cron Setup] 등록된 작업:"
    crontab -l | grep "$RENEW_SCRIPT"
fi

echo "[Cron Setup] 완료!"
echo "[Cron Setup] 로그 파일: /var/log/lnteletranslate-ssl-renew.log"

