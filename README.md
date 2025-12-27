# 텔레그램 번역 봇 (Node + OpenAI)

텔레그램 채팅에 들어오는 텍스트를 **OpenAI(GPT)로 번역**해서, 원문 메시지에 **답글 형태로 번역문을 전송**합니다.

## 준비물

- 텔레그램 봇 토큰 (BotFather)
- OpenAI API Key

## 설치

```bash
npm i
```

## 설정 파일 만들기

1) `config.example.json`을 복사해서 `config.json`을 만듭니다.  
2) `config.json`에 값을 채웁니다.

### 주요 설정

- `telegramBotToken`: 텔레그램 봇 토큰
- `openaiApiKey`: OpenAI API Key
- `targetLanguage`: 번역 목표 언어 (예: `Korean`, `English`, `Japanese` 등)
- `model`: 기본 `gpt-4o-mini`
- `allowedChatIds`: 지정하면 **해당 채팅 ID에서만** 동작 (미지정/`null`이면 전체 허용)

## 실행

```bash
npm run start
```

## 지원 모델 확인(내 키 기준)

아래 명령을 실행하면, **현재 `config.json`에 넣은 OpenAI 키로 접근 가능한 모델 ID**가 출력됩니다.

```bash
npm run list-models
```

## 사용

- 일반 텍스트 메시지를 보내면 번역 답글이 달립니다.
- `/ping` 을 보내면 `pong` 으로 응답합니다.

## HTTPS Webhook 설정

### 1. Let's Encrypt 인증서 발급

```bash
sudo ./scripts/setup-ssl.sh
```

이 스크립트는:
- certbot 설치 확인 및 설치
- `server.lunarsystem.co.kr` 도메인에 대한 인증서 발급
- 인증서 파일 권한 설정

**주의사항:**
- 인증서 발급 전에 DNS가 `server.lunarsystem.co.kr`을 서버 IP로 가리키고 있어야 합니다.
- 포트 80이 열려있어야 합니다 (Let's Encrypt 인증용).

### 2. 인증서 자동 갱신 설정

```bash
sudo ./scripts/setup-cron.sh
```

이 스크립트는 매일 새벽 3시에 인증서 갱신을 시도하는 cron 작업을 등록합니다.

### 3. Webhook 모드 설정

`config.json`에서 webhook 모드를 설정합니다:

```json
{
  "telegram": {
    "mode": "webhook",
    "webhook": {
      "publicUrl": "https://server.lunarsystem.co.kr",
      "path": "/telegram-webhook",
      "host": "0.0.0.0",
      "port": 58010,
      "certPath": "/etc/letsencrypt/live/server.lunarsystem.co.kr/fullchain.pem",
      "keyPath": "/etc/letsencrypt/live/server.lunarsystem.co.kr/privkey.pem"
    }
  }
}
```

### 4. 애플리케이션 실행

```bash
npm run start
```

애플리케이션이 HTTPS 서버로 시작되며, Telegram webhook이 자동으로 설정됩니다.

## 주의

- 그룹에서 쓰려면 봇을 그룹에 초대해야 합니다.
- 번역은 비용이 발생할 수 있어요. `allowedChatIds`로 제한하는 걸 추천합니다.
- Webhook 모드 사용 시 포트 58010이 외부에서 접근 가능해야 합니다 (방화벽 설정 확인).


