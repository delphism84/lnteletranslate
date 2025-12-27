#!/bin/bash

# systemd 서비스 상태 확인 스크립트

echo "=== 번역 봇 서비스 상태 ==="
echo ""
systemctl status lnteletranslate-khmer.service lnteletranslate-vietnam.service --no-pager
echo ""
echo "=== Docker 컨테이너 상태 ==="
docker ps --filter "name=lnteletranslate" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "=== 최근 로그 (크메르어) ==="
docker logs lnteletranslate-khmer --tail 5 2>&1
echo ""
echo "=== 최근 로그 (베트남어) ==="
docker logs lnteletranslate-vietnam --tail 5 2>&1

