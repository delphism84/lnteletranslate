-- lunar_ledger : 텔레그램 가계부 봇 스키마
-- 기준 통화(base) = USD. KHR/KRW 는 기록 시점 환율로 환산 보관.
-- book = home | office (가계부 분리 단위)

CREATE DATABASE IF NOT EXISTS lunar_ledger
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE lunar_ledger;

CREATE TABLE IF NOT EXISTS ledger_entry (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  book          ENUM('home','office') NOT NULL DEFAULT 'home',
  direction     ENUM('income','expense','transfer') NOT NULL,

  -- 금액: 원본 통화 그대로 보관(항상 양수) + USD 환산 스냅샷
  amount        DECIMAL(18,2) NOT NULL,
  currency      ENUM('USD','KHR','KRW') NOT NULL,
  rate_per_usd  DECIMAL(18,6) NOT NULL,   -- 1 USD 당 해당 통화 단위 (USD=1)
  amount_usd    DECIMAL(18,4) NOT NULL,   -- amount / rate_per_usd

  category      VARCHAR(32) DEFAULT NULL,
  memo          VARCHAR(255) DEFAULT NULL,
  quantity      INT DEFAULT NULL,
  occurred_at   DATE NOT NULL,

  -- 출처 추적
  source        ENUM('command','auto','web') NOT NULL DEFAULT 'command',
  confidence    DECIMAL(3,2) DEFAULT NULL, -- auto 추출 확신도
  tg_chat_id    BIGINT DEFAULT NULL,
  tg_message_id BIGINT DEFAULT NULL,
  tg_user_id    BIGINT DEFAULT NULL,
  tg_user_name  VARCHAR(64) DEFAULT NULL,
  raw_text      TEXT DEFAULT NULL,

  -- pending : 자동추출 후 확인 대기 / active : 확정 / void : 취소
  status        ENUM('pending','active','void') NOT NULL DEFAULT 'active',

  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 텔레그램 재전송/봇 재시작으로 인한 중복 기록 방지
  UNIQUE KEY uq_tg_msg (tg_chat_id, tg_message_id),
  KEY idx_book_period (book, status, occurred_at),
  KEY idx_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 자동 추출이 이미 처리한 대화 메시지. 봇을 재시작해도 같은 메시지를 두 번 묻지 않게 한다.
CREATE TABLE IF NOT EXISTS ledger_source_seen (
  source_id    VARCHAR(64) PRIMARY KEY,   -- covert-chats.json 의 id
  source_ts    BIGINT NOT NULL,
  entry_id     BIGINT DEFAULT NULL,       -- 거래로 판정돼 pending 으로 넣은 경우
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ts (source_ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 가계부 명령이 아닌 평문 대화 이력. 봇을 재시작해도 맥락이 이어지도록 DB 에 둔다.
CREATE TABLE IF NOT EXISTS ledger_chat_history (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  chat_id    BIGINT NOT NULL,
  role       ENUM('user','assistant') NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat (chat_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 채팅방별 설정: 어떤 book 에 기록할지, 단위 없는 숫자를 어떤 통화로 볼지
CREATE TABLE IF NOT EXISTS ledger_chat_setting (
  chat_id          BIGINT PRIMARY KEY,
  chat_title       VARCHAR(128) DEFAULT NULL,
  active_book      ENUM('home','office') NOT NULL DEFAULT 'home',
  default_currency ENUM('USD','KHR','KRW') NOT NULL DEFAULT 'USD',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
