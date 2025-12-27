#!/bin/bash
# systemd 서비스 생성 스크립트
# 사용법: sudo ./scripts/create-systemd-service.sh

set -e

SERVICE_NAME="lnteletranslate"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
APP_DIR="/lunar/lnteletranslate"
USER="root"

echo "[Systemd Setup] systemd 서비스 생성 중..."
echo "[Systemd Setup] 서비스 이름: $SERVICE_NAME"
echo "[Systemd Setup] 애플리케이션 디렉토리: $APP_DIR"

# nvm 경로 확인
NVM_DIR="/root/.nvm"
if [ ! -d "$NVM_DIR" ]; then
    echo "[Systemd Setup] 오류: nvm이 설치되어 있지 않습니다."
    exit 1
fi

# systemd 서비스 파일 생성
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=LN Telegram Translate Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment="NVM_DIR=$NVM_DIR"
Environment="PATH=$NVM_DIR/versions/node/$(ls $NVM_DIR/versions/node | sort -V | tail -1)/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=$NVM_DIR/versions/node/\$(ls $NVM_DIR/versions/node | sort -V | tail -1)/bin/node $APP_DIR/src/index.js
Restart=always
RestartSec=10
StandardOutput=append:$APP_DIR/app.log
StandardError=append:$APP_DIR/app.log

[Install]
WantedBy=multi-user.target
EOF

# 실제 Node.js 경로로 교체
NODE_VERSION=$(ls $NVM_DIR/versions/node | sort -V | tail -1)
NODE_PATH="$NVM_DIR/versions/node/$NODE_VERSION/bin/node"

if [ ! -f "$NODE_PATH" ]; then
    echo "[Systemd Setup] 오류: Node.js를 찾을 수 없습니다: $NODE_PATH"
    exit 1
fi

# 서비스 파일의 Node.js 경로를 실제 경로로 교체
sudo sed -i "s|ExecStart=.*|ExecStart=$NODE_PATH $APP_DIR/src/index.js|" "$SERVICE_FILE"

echo "[Systemd Setup] 서비스 파일 생성 완료: $SERVICE_FILE"

# systemd 데몬 리로드
sudo systemctl daemon-reload

# 서비스 활성화
sudo systemctl enable $SERVICE_NAME

echo "[Systemd Setup] 서비스 활성화 완료"
echo "[Systemd Setup] 서비스 시작: sudo systemctl start $SERVICE_NAME"
echo "[Systemd Setup] 서비스 상태 확인: sudo systemctl status $SERVICE_NAME"
echo "[Systemd Setup] 로그 확인: journalctl -u $SERVICE_NAME -f"

