# 크메르어 번역 봇 설정

한국어 ↔ 크메르어 자동 번역 텔레그램 봇 설정 가이드입니다.

## 설정 파일

`config.json` 파일을 편집하여 다음 정보를 입력하세요:

- `telegramBotToken`: 크메르어 번역 봇의 텔레그램 봇 토큰
- `openaiApiKey`: OpenAI API 키
- `allowedChatIds`: 허용할 채팅 ID 배열 (비어있으면 전체 허용)

## 설치 및 빌드

### 1. 의존성 설치

```bash
cd /lunar/lnteletranslate
npm install
```

### 2. 설정 파일 복사

```bash
cp configs/khmer/config.json config.json
```

### 3. 설정 파일 편집

`config.json` 파일을 열어서 실제 값으로 수정:

```json
{
  "telegramBotToken": "실제_봇_토큰",
  "openaiApiKey": "실제_API_키",
  ...
}
```

## 실행

### 개발 모드

```bash
npm run dev
```

### 프로덕션 모드

```bash
npm run start
```

### 백그라운드 실행 (PM2 사용)

```bash
pm2 start src/index.js --name lnteletranslate-khmer
pm2 save
pm2 startup
```

## 시스템 서비스로 등록

```bash
sudo ./scripts/create-systemd-service.sh
```

서비스 이름을 `lnteletranslate-khmer`로 설정하거나 스크립트를 수정하여 사용하세요.

## Webhook 모드 설정

HTTPS를 사용하는 경우:

1. SSL 인증서 설정:
```bash
sudo ./scripts/setup-ssl.sh
```

2. `config.json`에서 webhook 모드 활성화:
```json
{
  "telegram": {
    "mode": "webhook",
    "webhook": {
      "publicUrl": "https://your-domain.com",
      "path": "/telegram-webhook",
      "host": "0.0.0.0",
      "port": 58010,
      "certPath": "/etc/letsencrypt/live/your-domain.com/fullchain.pem",
      "keyPath": "/etc/letsencrypt/live/your-domain.com/privkey.pem"
    }
  }
}
```

## 번역 설정

- **한국어 → 크메르어**: 자동 번역
- **크메르어 → 한국어**: 자동 번역
- 양방향 자동 번역이 활성화되어 있습니다 (`autoTranslate: true`)

## 로그 확인

```bash
tail -f app.log
```

또는

```bash
./scripts/view-logs.sh
```

## 문제 해결

### 봇이 응답하지 않는 경우

1. 텔레그램 봇 토큰이 올바른지 확인
2. OpenAI API 키가 유효한지 확인
3. 네트워크 연결 확인 (프록시 필요 시 `proxyUrl` 설정)
4. 로그 파일 확인

### 번역이 작동하지 않는 경우

1. `autoTranslate`가 `true`로 설정되어 있는지 확인
2. `koreanTo`와 `khmerTo` 설정 확인
3. OpenAI API 할당량 확인

