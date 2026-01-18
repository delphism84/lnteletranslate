#!/bin/bash
# systemd 서비스 생성 스크립트 (docker compose 기반)
# 사용법: sudo ./scripts/create-systemd-docker-service.sh

set -e

SERVICE_NAME="lnteletranslate-docker"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
APP_DIR="/lunar/lnteletranslate"

if ! command -v docker >/dev/null 2>&1; then
  echo "[Systemd Setup] 오류: docker 가 설치되어 있지 않습니다."
  exit 1
fi

echo "[Systemd Setup] systemd 서비스 생성 중..."
echo "[Systemd Setup] 서비스 이름: $SERVICE_NAME"
echo "[Systemd Setup] 애플리케이션 디렉토리: $APP_DIR"

sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=LN Telegram Translate Bots (Docker Compose)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
RemainAfterExit=yes

# 부팅/서비스 시작 시 compose 스택 기동
ExecStart=/usr/bin/docker compose up -d --build --remove-orphans

# 서비스 중지 시 스택 내림
ExecStop=/usr/bin/docker compose down

TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "[Systemd Setup] 서비스 파일 생성 완료: $SERVICE_FILE"

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo "[Systemd Setup] 서비스 활성화 완료"
echo "[Systemd Setup] 시작: sudo systemctl start $SERVICE_NAME"
echo "[Systemd Setup] 상태: sudo systemctl status $SERVICE_NAME"
echo "[Systemd Setup] 로그: journalctl -u $SERVICE_NAME -f"

