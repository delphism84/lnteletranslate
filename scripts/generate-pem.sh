#!/bin/bash

# PEM 인증서 생성 / Let's Encrypt 내보내기 / 다운로드용 zip 패키징
#
# 사용법:
#   ./scripts/generate-pem.sh                         # self-signed 생성 (기본 도메인)
#   ./scripts/generate-pem.sh --domain example.com    # 도메인 지정
#   ./scripts/generate-pem.sh --export                # /etc/letsencrypt → ./certs/ 복사
#   ./scripts/generate-pem.sh --export --domain X     # 특정 도메인 export
#   ./scripts/generate-pem.sh --serve                 # zip 생성 후 HTTP 다운로드 서버 (8080)
#   ./scripts/generate-pem.sh --serve 9000            # 포트 지정

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CERTS_DIR="$PROJECT_DIR/certs"

DOMAIN="${DOMAIN:-server.lunarsystem.co.kr}"
MODE="self-signed"
SERVE_PORT=""

usage() {
  sed -n '3,11p' "$0"
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage 0
      ;;
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --export)
      MODE="export"
      shift
      ;;
    --serve)
      MODE="serve"
      shift
      if [[ $# -gt 0 && "$1" =~ ^[0-9]+$ ]]; then
        SERVE_PORT="$1"
        shift
      fi
      ;;
    *)
      echo "[generate-pem] 알 수 없는 옵션: $1" >&2
      usage 1
      ;;
  esac
done

[[ -z "$SERVE_PORT" ]] && SERVE_PORT="8080"

OUT_DIR="$CERTS_DIR/$DOMAIN"
FULLCHAIN="$OUT_DIR/fullchain.pem"
PRIVKEY="$OUT_DIR/privkey.pem"
ZIP_PATH="$CERTS_DIR/${DOMAIN}.zip"

require_openssl() {
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[generate-pem] openssl이 필요합니다. (예: sudo apt-get install -y openssl)" >&2
    exit 1
  fi
}

write_readme() {
  cat > "$OUT_DIR/README.txt" <<EOF
도메인: $DOMAIN
생성 시각: $(date -Iseconds)

파일:
  fullchain.pem  — 인증서 체인 (config.json 의 certPath)
  privkey.pem    — 개인키 (config.json 의 keyPath)

config.json 예시:
  "certPath": "./certs/$DOMAIN/fullchain.pem"
  "keyPath": "./certs/$DOMAIN/privkey.pem"

주의: privkey.pem 은 비밀키입니다. git 에 커밋하거나 공유하지 마세요.
EOF
}

create_zip() {
  mkdir -p "$CERTS_DIR"
  rm -f "$ZIP_PATH"
  if command -v zip >/dev/null 2>&1; then
    (cd "$CERTS_DIR" && zip -r "${DOMAIN}.zip" "$DOMAIN" >/dev/null)
  else
    echo "[generate-pem] zip 명령이 없어 tar.gz 로 패키징합니다."
    ZIP_PATH="$CERTS_DIR/${DOMAIN}.tar.gz"
    rm -f "$ZIP_PATH"
    tar -czf "$ZIP_PATH" -C "$CERTS_DIR" "$DOMAIN"
  fi
  echo "[generate-pem] 다운로드 패키지: $ZIP_PATH"
}

generate_self_signed() {
  require_openssl
  mkdir -p "$OUT_DIR"

  echo "[generate-pem] self-signed 인증서 생성: $DOMAIN"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$PRIVKEY" \
    -out "$FULLCHAIN" \
    -days 365 \
    -subj "/CN=$DOMAIN" \
    -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

  chmod 600 "$PRIVKEY"
  chmod 644 "$FULLCHAIN"
  write_readme
  create_zip

  echo "[generate-pem] 완료"
  echo "[generate-pem]   cert: $FULLCHAIN"
  echo "[generate-pem]   key:  $PRIVKEY"
}

export_letsencrypt() {
  SRC_DIR="/etc/letsencrypt/live/$DOMAIN"
  SRC_FULL="$SRC_DIR/fullchain.pem"
  SRC_KEY="$SRC_DIR/privkey.pem"

  if [[ ! -f "$SRC_FULL" || ! -f "$SRC_KEY" ]]; then
    echo "[generate-pem] Let's Encrypt 인증서를 찾을 수 없습니다: $SRC_DIR" >&2
    echo "[generate-pem] 먼저 sudo ./scripts/setup-ssl.sh 를 실행하세요." >&2
    exit 1
  fi

  mkdir -p "$OUT_DIR"
  echo "[generate-pem] Let's Encrypt 인증서 내보내기: $DOMAIN"

  if [[ -r "$SRC_FULL" && -r "$SRC_KEY" ]]; then
    cp "$SRC_FULL" "$FULLCHAIN"
    cp "$SRC_KEY" "$PRIVKEY"
  else
    sudo cp "$SRC_FULL" "$FULLCHAIN"
    sudo cp "$SRC_KEY" "$PRIVKEY"
    sudo chown "$(id -u):$(id -g)" "$FULLCHAIN" "$PRIVKEY"
  fi

  chmod 644 "$FULLCHAIN"
  chmod 600 "$PRIVKEY"
  write_readme
  create_zip

  echo "[generate-pem] 완료"
  echo "[generate-pem]   cert: $FULLCHAIN"
  echo "[generate-pem]   key:  $PRIVKEY"
}

serve_download() {
  if [[ ! -d "$OUT_DIR" ]]; then
    export_letsencrypt 2>/dev/null || generate_self_signed
  else
    create_zip
  fi

  echo ""
  echo "[generate-pem] 다운로드 서버 시작 (Ctrl+C 로 종료)"
  echo "[generate-pem]   http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1):$SERVE_PORT/$(basename "$ZIP_PATH")"
  echo "[generate-pem]   http://127.0.0.1:$SERVE_PORT/$(basename "$ZIP_PATH")"
  echo ""

  cd "$CERTS_DIR"
  if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server "$SERVE_PORT" --bind 0.0.0.0
  elif command -v python >/dev/null 2>&1; then
    python -m SimpleHTTPServer "$SERVE_PORT"
  else
    echo "[generate-pem] python3 가 없어 HTTP 서버를 시작할 수 없습니다." >&2
    echo "[generate-pem] zip 파일을 직접 복사하세요: $ZIP_PATH" >&2
    exit 1
  fi
}

case "$MODE" in
  self-signed)
    generate_self_signed
    ;;
  export)
    export_letsencrypt
    ;;
  serve)
    serve_download
    ;;
esac
