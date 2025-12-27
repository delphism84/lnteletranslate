#!/bin/bash

# 크메르어 번역 봇 중지 스크립트

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.tele-translate.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "PID 파일이 없습니다. 프로세스가 실행 중이지 않을 수 있습니다."
    exit 1
fi

PID=$(cat "$PID_FILE")

if ps -p "$PID" > /dev/null 2>&1; then
    echo "크메르어 번역 봇을 중지합니다 (PID: $PID)..."
    kill "$PID"
    rm -f "$PID_FILE"
    echo "✅ 크메르어 번역 봇이 중지되었습니다."
else
    echo "프로세스가 실행 중이지 않습니다 (PID: $PID)"
    rm -f "$PID_FILE"
fi

