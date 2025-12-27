#!/bin/bash
# nginx 리버스 프록시 설정 스크립트
# 사용법: sudo ./scripts/setup-nginx.sh

set -e

DOMAIN="server.lunarsystem.co.kr"
WEBHOOK_PORT=58010
NGINX_CONF="/etc/nginx/sites-available/telegram-webhook"

echo "[Nginx Setup] nginx 리버스 프록시 설정 중..."
echo "[Nginx Setup] 도메인: $DOMAIN"
echo "[Nginx Setup] 백엔드 포트: $WEBHOOK_PORT"

# nginx 설정 파일 생성
sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 443 ssl;
    http2 on;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    # SSL 설정
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Telegram webhook 경로
    location /telegram-webhook {
        proxy_pass https://127.0.0.1:$WEBHOOK_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # SSL 인증서 검증 비활성화 (로컬 프록시이므로)
        proxy_ssl_verify off;
        
        # 타임아웃 설정
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 기본 경로 (선택사항)
    location / {
        return 200 'Telegram Webhook Server';
        add_header Content-Type text/plain;
    }
}
EOF

# 심볼릭 링크 생성
if [ ! -L "/etc/nginx/sites-enabled/telegram-webhook" ]; then
    sudo ln -s "$NGINX_CONF" /etc/nginx/sites-enabled/
    echo "[Nginx Setup] 심볼릭 링크 생성 완료"
fi

# nginx 설정 테스트
echo "[Nginx Setup] nginx 설정 테스트 중..."
sudo nginx -t

# nginx 재시작
echo "[Nginx Setup] nginx 재시작 중..."
sudo systemctl restart nginx

echo "[Nginx Setup] 완료!"
echo "[Nginx Setup] 설정 파일: $NGINX_CONF"
echo "[Nginx Setup] 이제 Telegram webhook URL을 https://$DOMAIN/telegram-webhook 로 설정하세요."

