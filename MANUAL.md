# 다국어 번역 봇 설정 매뉴얼

이 프로젝트는 한국어와 크메르어, 베트남어 간의 자동 번역을 지원하는 텔레그램 봇입니다.

## 목차

1. [전체 설치 가이드](#전체-설치-가이드)
2. [크메르어 봇 설정](#크메르어-봇-설정)
3. [베트남어 봇 설정](#베트남어-봇-설정)
4. [빌드 및 실행 명령어](#빌드-및-실행-명령어)
5. [문제 해결](#문제-해결)

## 전체 설치 가이드

### 1. 저장소 클론

```bash
git clone git@github.com:delphism84/lnteletranslate.git
cd lnteletranslate
```

### 2. 의존성 설치

```bash
npm install
```

### 3. 언어별 설정 선택

크메르어 또는 베트남어 중 하나를 선택하여 설정 파일을 준비합니다.

#### Docker로 2개 봇 동시 운영(권장)

- 크메르: `configs/khmer.example.json`
- 베트남: `configs/viet.example.json`

`docker-compose.yml`이 위 두 파일을 각각 컨테이너 `/app/config.json`으로 마운트해서 2개 봇을 동시에 띄웁니다.

### 4. 설정 파일 편집

설정 파일을 열어서 다음 값을 입력합니다:

- `telegramBotToken`: 텔레그램 봇 토큰 (BotFather에서 발급)
- `geminiApiKey`: Gemini API 키
- `openaiApiKey`: OpenAI API 키 (Gemini 실패 시 폴백용)
- `allowedChatIds`: 허용할 채팅 ID 배열 (선택사항)

## 크메르어 봇 설정

### 빠른 시작

```bash
# Docker 시작 (2개 같이)
./scripts/docker-start.sh
```

### 상세 설정

자세한 내용은 [configs/khmer/README.md](configs/khmer/README.md)를 참조하세요.

## 베트남어 봇 설정

### 빠른 시작

```bash
# Docker 시작 (2개 같이)
./scripts/docker-start.sh
```

### 상세 설정

자세한 내용은 [configs/vietnam/README.md](configs/vietnam/README.md)를 참조하세요.

## 빌드 및 실행 명령어

### 공통 명령어

#### 의존성 설치
```bash
npm install
```

#### 개발 모드 실행
```bash
npm run dev
```

#### 프로덕션 모드 실행
```bash
npm run start
```

#### 사용 가능한 모델 확인
```bash
npm run list-models
```

### 크메르어 봇 전용 명령어

#### 시작
```bash
./scripts/start-khmer.sh
```

#### 중지
```bash
./scripts/stop-khmer.sh
```

#### 로그 확인
```bash
tail -f app.log
# 또는
./scripts/view-logs.sh
```

### 베트남어 봇 전용 명령어

#### 시작
```bash
./scripts/start-vietnam.sh
```

#### 중지
```bash
./scripts/stop-vietnam.sh
```

#### 로그 확인
```bash
tail -f app.log
# 또는
./scripts/view-logs.sh
```

### PM2를 사용한 백그라운드 실행

#### 크메르어 봇
```bash
pm2 start src/index.js --name lnteletranslate-khmer
pm2 save
pm2 startup
```

#### 베트남어 봇
```bash
pm2 start src/index.js --name lnteletranslate-vietnam
pm2 save
pm2 startup
```

### 시스템 서비스로 등록

```bash
sudo ./scripts/create-systemd-service.sh
```

서비스 이름을 언어별로 다르게 설정하거나 스크립트를 수정하여 사용하세요.

## 동시 실행 (크메르어 + 베트남어)

두 봇을 동시에 실행하려면 Docker Compose를 사용하세요:

```bash
./scripts/docker-start.sh
```

## Webhook 모드 설정

HTTPS를 사용하는 경우:

### 1. SSL 인증서 발급

```bash
sudo ./scripts/setup-ssl.sh
```

### 2. 인증서 자동 갱신 설정

```bash
sudo ./scripts/setup-cron.sh
```

### 3. config.json 수정

크메르어 봇 (포트 64000):
```json
{
  "telegram": {
    "mode": "webhook",
    "webhook": {
      "publicUrl": "https://your-domain.com",
      "path": "/telegram-webhook",
      "host": "0.0.0.0",
      "port": 64000,
      "certPath": "/etc/letsencrypt/live/your-domain.com/fullchain.pem",
      "keyPath": "/etc/letsencrypt/live/your-domain.com/privkey.pem"
    }
  }
}
```

베트남어 봇 (포트 64001):
```json
{
  "telegram": {
    "mode": "webhook",
    "webhook": {
      "publicUrl": "https://your-domain.com",
      "path": "/telegram-webhook-vietnam",
      "host": "0.0.0.0",
      "port": 64001,
      "certPath": "/etc/letsencrypt/live/your-domain.com/fullchain.pem",
      "keyPath": "/etc/letsencrypt/live/your-domain.com/privkey.pem"
    }
  }
}
```

## 문제 해결

### 봇이 응답하지 않는 경우

1. **텔레그램 봇 토큰 확인**
   - BotFather에서 봇 토큰이 올바른지 확인
   - 봇이 그룹에 초대되었는지 확인

2. **OpenAI API 키 확인**
   - API 키가 유효한지 확인
   - 할당량이 남아있는지 확인

3. **네트워크 연결 확인**
   - 텔레그램 접속이 막힌 환경이면 `proxyUrl` 설정
   - 인터넷 연결 상태 확인

4. **로그 확인**
   ```bash
   tail -f app.log
   ```

### 번역이 작동하지 않는 경우

1. **설정 확인**
   - `autoTranslate`가 `true`로 설정되어 있는지 확인
   - `koreanTo`, `khmerTo` / `vietnameseTo` 설정 확인

2. **모델 확인**
   ```bash
   npm run list-models
   ```

3. **입력 길이 확인**
   - `maxInputChars` 설정 확인 (기본값: 2500자)

### 포트 충돌 문제

크메르어와 베트남어 봇을 동시에 실행할 때:
- 크메르어 봇: 포트 64000 (webhook 모드)
- 베트남어 봇: 포트 64001 (webhook 모드)

포트가 충돌하면 `config.json`에서 포트 번호를 변경하세요.

## 추가 리소스

- [크메르어 봇 상세 가이드](configs/khmer/README.md)
- [베트남어 봇 상세 가이드](configs/vietnam/README.md)
- [메인 README](README.md)

