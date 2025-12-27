#!/bin/bash

# Let's Encrypt 인증서 자동 갱신 스크립트
# cron에 등록하여 사용: 0 3 * * * /path/to/scripts/renew-ssl.sh

set -e

DOMAIN="server.lunarsystem.co.kr"
SERVICE_NAME="lnteletranslate"  # systemd 서비스 이름 (필요시 변경)
APP_DIR="/lunar/lnteletranslate"

echo "[SSL Renew] 인증서 갱신 시작: $(date)"

# certbot으로 인증서 갱신 시도
if sudo certbot renew --quiet --no-self-upgrade; then
    echo "[SSL Renew] 인증서 갱신 완료"
    
    # 인증서가 실제로 갱신되었는지 확인
    CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    if [ -f "$CERT_PATH" ]; then
        # 인증서 권한 업데이트
        sudo chmod 644 "$CERT_PATH"
        sudo chmod 644 "/etc/letsencrypt/live/$DOMAIN/privkey.pem"
        
        echo "[SSL Renew] 인증서 권한 업데이트 완료"
        
        # 애플리케이션 재시작 (선택사항)
        # systemd를 사용하는 경우:
        # if systemctl is-active --quiet "$SERVICE_NAME"; then
        #     echo "[SSL Renew] 서비스 재시작 중..."
        #     sudo systemctl restart "$SERVICE_NAME"
        # fi
        
        # 또는 PM2를 사용하는 경우:
        # if command -v pm2 &> /dev/null; then
        #     echo "[SSL Renew] PM2로 애플리케이션 재시작 중..."
        #     cd "$APP_DIR"
        #     pm2 restart lnteletranslate || true
        # fi
        
        # 또는 PID 파일을 사용하는 경우:
        PID_FILE="$APP_DIR/.tele-translate.pid"
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                echo "[SSL Renew] 애플리케이션 재시작 필요 (PID: $PID)"
                echo "[SSL Renew] 수동으로 재시작하거나 자동 재시작 스크립트를 설정하세요."
            fi
        fi
    fi
else
    echo "[SSL Renew] 인증서 갱신 실패 또는 갱신 불필요"
fi

echo "[SSL Renew] 완료: $(date)"

