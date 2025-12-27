# Docker를 사용한 번역 봇 실행 가이드

이 가이드는 Docker를 사용하여 크메르어 및 베트남어 번역 봇을 실행하는 방법을 설명합니다.

## 목차

1. [사전 요구사항](#사전-요구사항)
2. [환경변수 설정](#환경변수-설정)
3. [Docker 빌드 및 실행](#docker-빌드-및-실행)
4. [언어 선택 기능](#언어-선택-기능)
5. [문제 해결](#문제-해결)

## 사전 요구사항

- Docker 및 Docker Compose 설치
- 텔레그램 봇 토큰 (크메르어용, 베트남어용 각각)
- OpenAI API 키

## 환경변수 설정

### 1. .env 파일 생성

`.env.example`을 복사하여 `.env` 파일을 생성합니다:

```bash
cp .env.example .env
```

### 2. .env 파일 편집

`.env` 파일을 열어서 다음 값들을 입력합니다:

```env
# OpenAI API 키 (공통)
OPENAI_API_KEY=sk-proj-...

# 텔레그램 봇 토큰 (크메르어)
TELEGRAM_BOT_TOKEN_KHMER=1234567890:ABCdef...

# 텔레그램 봇 토큰 (베트남어)
TELEGRAM_BOT_TOKEN_VIETNAM=1234567890:XYZuvw...

# 텔레그램 모드 (polling 또는 webhook)
TELEGRAM_MODE=polling

# Webhook 설정 (webhook 모드일 때만 사용)
WEBHOOK_PUBLIC_URL_KHMER=https://your-domain.com
WEBHOOK_PUBLIC_URL_VIETNAM=https://your-domain.com
WEBHOOK_CERT_PATH=/etc/letsencrypt/live/your-domain.com/fullchain.pem
WEBHOOK_KEY_PATH=/etc/letsencrypt/live/your-domain.com/privkey.pem
SSL_CERT_PATH=/etc/letsencrypt
```

## Docker 빌드 및 실행

### 전체 실행 (크메르어 + 베트남어)

```bash
# 빌드 및 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 중지
docker-compose down
```

### 크메르어만 실행

```bash
# 빌드 및 실행
docker-compose -f docker-compose.khmer.yml up -d

# 로그 확인
docker-compose -f docker-compose.khmer.yml logs -f

# 중지
docker-compose -f docker-compose.khmer.yml down
```

### 베트남어만 실행

```bash
# 빌드 및 실행
docker-compose -f docker-compose.vietnam.yml up -d

# 로그 확인
docker-compose -f docker-compose.vietnam.yml logs -f

# 중지
docker-compose -f docker-compose.vietnam.yml down
```

## 언어 선택 기능

봇이 실행되면 텔레그램에서 다음 명령어를 사용하여 언어를 선택할 수 있습니다:

- `/언어 1` - 크메르어 모드로 설정 (한국어 ↔ 크메르어)
- `/언어 2` - 베트남어 모드로 설정 (한국어 ↔ 베트남어)
- `/언어 리셋` 또는 `/언어 0` - 자동 감지 모드로 리셋

### 사용 예시

1. 크메르어 모드 설정:
   ```
   사용자: /언어 1
   봇: ✅ 크메르어 모드로 설정되었습니다.
       한국어 ↔ 크메르어 번역이 활성화됩니다.
   ```

2. 베트남어 모드 설정:
   ```
   사용자: /언어 2
   봇: ✅ 베트남어 모드로 설정되었습니다.
       한국어 ↔ 베트남어 번역이 활성화됩니다.
   ```

3. 자동 감지 모드로 리셋:
   ```
   사용자: /언어 리셋
   봇: ✅ 자동 감지 모드로 리셋되었습니다.
       메시지를 분석하여 자동으로 언어를 감지합니다.
   ```

## 디스크 마운트

로그 파일은 호스트의 `./data/khmer/logs` 및 `./data/vietnam/logs` 디렉토리에 마운트됩니다.

### 로그 확인

```bash
# 크메르어 봇 로그
tail -f data/khmer/logs/app.log

# 베트남어 봇 로그
tail -f data/vietnam/logs/app.log
```

### SSL 인증서 마운트

Webhook 모드를 사용하는 경우, SSL 인증서가 `/etc/letsencrypt`에 마운트됩니다. 호스트의 인증서 경로를 `SSL_CERT_PATH` 환경변수로 지정할 수 있습니다.

## 문제 해결

### 컨테이너가 시작되지 않는 경우

1. 로그 확인:
   ```bash
   docker-compose logs
   ```

2. 환경변수 확인:
   ```bash
   docker-compose config
   ```

3. 포트 충돌 확인:
   - 크메르어 봇: 포트 58010
   - 베트남어 봇: 포트 58011

### 봇이 응답하지 않는 경우

1. 텔레그램 봇 토큰 확인
2. OpenAI API 키 확인
3. 네트워크 연결 확인 (프록시 필요 시 `TELEGRAM_PROXY_URL` 설정)

### Webhook 모드 사용 시

1. SSL 인증서 경로 확인
2. `WEBHOOK_PUBLIC_URL`이 올바른지 확인
3. 포트가 외부에서 접근 가능한지 확인

## 추가 명령어

### 컨테이너 재시작

```bash
docker-compose restart
```

### 컨테이너 재빌드

```bash
docker-compose build --no-cache
docker-compose up -d
```

### 특정 서비스만 재시작

```bash
# 크메르어 봇만 재시작
docker-compose restart lnteletranslate-khmer

# 베트남어 봇만 재시작
docker-compose restart lnteletranslate-vietnam
```

### 컨테이너 내부 접속

```bash
docker exec -it lnteletranslate-khmer sh
docker exec -it lnteletranslate-vietnam sh
```

