#!/bin/bash
# 서비스 제어 스크립트
# 사용법: ./scripts/service-control.sh [start|stop|restart|status|logs|enable|disable]

SERVICE_NAME="lnteletranslate"
if systemctl list-unit-files | grep -q "^lnteletranslate-docker\\.service"; then
    SERVICE_NAME="lnteletranslate-docker"
fi

case "$1" in
    start)
        echo "[서비스] 시작 중..."
        sudo systemctl start $SERVICE_NAME
        sudo systemctl status $SERVICE_NAME --no-pager | head -15
        ;;
    stop)
        echo "[서비스] 중지 중..."
        sudo systemctl stop $SERVICE_NAME
        echo "[서비스] 중지 완료"
        ;;
    restart)
        echo "[서비스] 재시작 중..."
        sudo systemctl restart $SERVICE_NAME
        sleep 2
        sudo systemctl status $SERVICE_NAME --no-pager | head -15
        ;;
    status)
        echo "[서비스] 상태 확인:"
        sudo systemctl status $SERVICE_NAME --no-pager
        ;;
    logs)
        echo "[서비스] 로그 확인 (Ctrl+C로 종료):"
        sudo journalctl -u $SERVICE_NAME -f
        ;;
    enable)
        echo "[서비스] 부팅 시 자동 시작 활성화 중..."
        sudo systemctl enable $SERVICE_NAME
        echo "[서비스] 자동 시작 활성화 완료"
        ;;
    disable)
        echo "[서비스] 부팅 시 자동 시작 비활성화 중..."
        sudo systemctl disable $SERVICE_NAME
        echo "[서비스] 자동 시작 비활성화 완료"
        ;;
    *)
        echo "사용법: $0 [start|stop|restart|status|logs|enable|disable]"
        echo ""
        echo "명령어:"
        echo "  start    - 서비스 시작"
        echo "  stop     - 서비스 중지"
        echo "  restart  - 서비스 재시작"
        echo "  status   - 서비스 상태 확인"
        echo "  logs     - 실시간 로그 확인"
        echo "  enable   - 부팅 시 자동 시작 활성화"
        echo "  disable  - 부팅 시 자동 시작 비활성화"
        exit 1
        ;;
esac

