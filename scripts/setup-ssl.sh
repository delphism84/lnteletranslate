#!/bin/bash

# Let's Encrypt 인증서 발급 스크립트
# 사용법: sudo ./scripts/setup-ssl.sh

set -e

DOMAIN="server.lunarsystem.co.kr"
EMAIL="admin@lunarsystem.co.kr"  # Let's Encrypt 알림용 이메일 (변경 필요)
WEBHOOK_PORT=58010

echo "[SSL Setup] 도메인: $DOMAIN"
echo "[SSL Setup] 이메일: $EMAIL"

# certbot 설치 확인
if ! command -v certbot &> /dev/null; then
    echo "[SSL Setup] certbot이 설치되어 있지 않습니다. 설치 중..."
    sudo apt-get update
    sudo apt-get install -y certbot
fi

# 포트 80이 열려있는지 확인 (Let's Encrypt 인증을 위해 필요)
if ! sudo netstat -tuln | grep -q ":80 "; then
    echo "[SSL Setup] 경고: 포트 80이 열려있지 않습니다."
    echo "[SSL Setup] Let's Encrypt 인증을 위해 포트 80이 필요합니다."
    echo "[SSL Setup] nginx나 다른 웹서버를 사용하거나, standalone 모드를 사용하세요."
fi

# 인증서 발급 (standalone 모드 - 포트 80을 직접 사용)
echo "[SSL Setup] 인증서 발급 중..."
sudo certbot certonly --standalone \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    --preferred-challenges http

# 인증서 경로 확인
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/$DOMAIN/privkey.pem"

if [ -f "$CERT_PATH" ] && [ -f "$KEY_PATH" ]; then
    echo "[SSL Setup] 인증서 발급 완료!"
    echo "[SSL Setup] 인증서 경로: $CERT_PATH"
    echo "[SSL Setup] 키 경로: $KEY_PATH"
    
    # 인증서 권한 확인 (node 사용자가 읽을 수 있도록)
    echo "[SSL Setup] 인증서 권한 확인 중..."
    sudo chmod 644 "$CERT_PATH"
    sudo chmod 644 "$KEY_PATH"
    
    echo "[SSL Setup] 완료! 이제 애플리케이션을 재시작하세요."
else
    echo "[SSL Setup] 오류: 인증서 파일을 찾을 수 없습니다."
    exit 1
fi

