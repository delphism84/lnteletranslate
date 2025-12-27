#!/bin/bash

# 베트남어 번역 봇 시작 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR" || exit 1

# 설정 파일 복사
if [ ! -f "config.json" ]; then
    echo "config.json이 없습니다. configs/vietnam/config.json을 복사합니다..."
    cp configs/vietnam/config.json config.json
    echo "⚠️  config.json을 편집하여 실제 값을 입력하세요!"
    exit 1
fi

# PID 파일 확인
PID_FILE="$PROJECT_DIR/.tele-translate.pid"
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "이미 실행 중인 프로세스가 있습니다 (PID: $OLD_PID)"
        echo "중지하려면: kill $OLD_PID 또는 ./scripts/stop-vietnam.sh"
        exit 1
    else
        echo "오래된 PID 파일을 삭제합니다..."
        rm -f "$PID_FILE"
    fi
fi

# 의존성 확인
if [ ! -d "node_modules" ]; then
    echo "의존성을 설치합니다..."
    npm install
fi

# 실행
echo "베트남어 번역 봇을 시작합니다..."
node src/index.js &
NEW_PID=$!
echo $NEW_PID > "$PID_FILE"
echo "✅ 베트남어 번역 봇이 시작되었습니다 (PID: $NEW_PID)"
echo "로그 확인: tail -f app.log"

