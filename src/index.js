const TelegramBot = require("node-telegram-bot-api");
const { loadConfig } = require("./config");
const { createOpenAIClient, createGeminiClient, translateText } = require("./openaiClient");
const { acquirePidLock } = require("./pidLock");
const express = require("express");
const https = require("https");
const fs = require("fs");

function isEmojiOnly(text) {
  if (!text || typeof text !== "string") return false;
  
  // 이모지와 공백, 특수문자만 있는지 확인
  // 일반 문자(한글, 영문, 숫자, 크메르어, 베트남어 등)를 모두 제거
  const withoutEmojis = text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // 이모지 범위 1
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // 이모지 범위 2
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // 이모지 범위 3
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // 이모지 범위 4 (감정)
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // 이모지 범위 5 (교통)
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // 이모지 범위 6 (추가)
    .replace(/[\u{1FA00}-\u{1FAFF}]/gu, '') // 이모지 범위 7 (추가)
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // 변형 선택자
    .replace(/[\u{200D}]/gu, '')            // 제로 너비 결합자
    .replace(/[\s\p{P}]/gu, '');            // 공백과 구두점 제거
  
  // 일반 문자를 제거한 후 남은 것이 없으면 이모지만 있는 것
  const hasNormalChars = /[\uAC00-\uD7A3\u1780-\u17FFa-zA-Z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/.test(text);
  
  // 일반 문자가 없고, 이모지만 있으면 true
  return !hasNormalChars && text.trim().length > 0;
}

function shouldProcessMessage(msg, cfg) {
  const chatId = msg?.chat?.id;
  if (chatId == null) return false;

  // allowedChatIds가 배열이고, 비어있지 않을 때만 필터 적용
  if (Array.isArray(cfg.allowedChatIds) && cfg.allowedChatIds.length > 0) {
    if (!cfg.allowedChatIds.includes(chatId)) return false;
  }

  const text = msg?.text;
  if (typeof text !== "string" || !text.trim()) return false;
  if (text.startsWith("/")) return false; // 명령어는 패스
  
  // 이모티콘만 있는 메시지는 처리하지 않음
  if (isEmojiOnly(text)) {
    console.log(`[message] Emoji-only message filtered out: ${text.substring(0, 20)}`);
    return false;
  }

  return true;
}

function detectScript(text, assumeLatinIsVietnamese = false) {
  if (!text || typeof text !== "string") return "unknown";
  
  // 특수문자와 이모지만 있는 경우 제거하고 판단
  const cleanText = text.replace(/[\s\p{P}\p{S}\p{Emoji}]/gu, "");
  if (!cleanText) return "unknown"; // 특수문자/이모지만 있으면 unknown
  
  // 베트남어 봇용 언어 감지 (크메르어 지원 포함)
  // - hangul: 가-힣
  // - khmer: U+1780–U+17FF (Khmer)
  // - vietnamese: 베트남어 특수 문자 (ă, â, ê, ô, ơ, ư, đ 등)
  const hasHangul = /[\uAC00-\uD7A3]/.test(text);
  const hasKhmer = /[\u1780-\u17FF]/.test(text);
  const hasVietnameseChars = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  
  // 크메르어가 있으면 크메르어로 감지 (우선순위 높음)
  if (hasKhmer && !hasHangul && !hasVietnameseChars) return "khmer";
  if (hasHangul && !hasKhmer && !hasVietnameseChars) return "hangul";
  if (hasVietnameseChars || (assumeLatinIsVietnamese && hasLatin && !hasHangul && !hasKhmer)) return "vietnamese";
  if (hasHangul && hasVietnameseChars) return "mixed";
  if (hasHangul && hasKhmer) return "mixed";
  
  // 라틴 문자만 있으면 베트남어로 간주 (assumeLatinIsVietnamese가 true인 경우)
  if (assumeLatinIsVietnamese && hasLatin && !hasHangul && !hasKhmer && !hasVietnameseChars) {
    return "vietnamese";
  }
  
  return "unknown";
}

function pickTargetLanguage(cfg, text, replyText, forcedLanguage = null) {
  if (!cfg.autoTranslate) return cfg.targetLanguage || "Korean";

  const assumeLatinIsVietnamese = cfg.assumeLatinIsVietnamese !== false;
  const script = detectScript(text, assumeLatinIsVietnamese);

  // 강제 언어가 지정된 경우 (예: /언어 1로 크메르어 선택)
  if (forcedLanguage === "Khmer" || forcedLanguage === "khmer") {
    // 한글 입력이면 크메르어로 번역, 크메르어 입력이면 한글로 번역
    if (script === "hangul") return "Khmer"; // 한글 -> 크메르어
    if (script === "khmer") return cfg.khmerTo || "Korean"; // 크메르어 -> 한글
    // 기타 경우에도 크메르어로 번역
    return "Khmer";
  }
  if (forcedLanguage === "Vietnamese" || forcedLanguage === "vietnamese") {
    // 한글 입력이면 베트남어로 번역, 베트남어 입력이면 한글로 번역
    if (script === "hangul") return cfg.koreanTo || "Vietnamese"; // 한글 -> 베트남어
    if (script === "vietnamese") return cfg.vietnameseTo || "Korean"; // 베트남어 -> 한글
    // 기타 경우에도 베트남어로 번역
    return cfg.koreanTo || "Vietnamese";
  }

  // 자동 감지 모드
  if (script === "hangul") return cfg.koreanTo; // 한글 -> 베트남어
  if (script === "vietnamese") return cfg.vietnameseTo || "Korean"; // 베트남어 -> 한글
  if (script === "khmer") return cfg.khmerTo || "Korean"; // 크메르어 -> 한글

  // 답글(Reply)이 있고 현재 메시지가 애매하면, "답글 대상 메시지"를 기준으로 방향을 추정합니다.
  // 답글이 있으면 더 적극적으로 답글의 언어를 기준으로 판단
  if (typeof replyText === "string" && replyText.trim()) {
    const replyScript = detectScript(replyText, assumeLatinIsVietnamese);
    
    // 답글의 언어가 명확하면 그것을 기준으로 판단
    if (replyScript === "hangul") {
      // 답글이 한글이면, 현재 메시지는 베트남어/크메르어일 가능성이 높음 -> 한글로 번역
      return cfg.vietnameseTo || cfg.khmerTo || "Korean";
    }
    if (replyScript === "vietnamese") {
      // 답글이 베트남어면, 현재 메시지는 한글일 가능성이 높음 -> 베트남어로 번역
      return cfg.koreanTo || "Vietnamese";
    }
    if (replyScript === "khmer") {
      // 답글이 크메르어면, 현재 메시지는 한글일 가능성이 높음 -> 크메르어로 번역
      return cfg.koreanTo || "Khmer";
    }
    
    // 답글도 감지가 안 되면, 답글의 텍스트 길이와 패턴으로 추정
    // 짧은 답글(예: "네", "yes", "ok")은 한글일 가능성이 높음
    if (replyText.length <= 10 && /^[가-힣\s]+$/.test(replyText)) {
      return cfg.vietnameseTo || cfg.khmerTo || "Korean";
    }
  }

  // 섞였거나 애매하면, 기존 targetLanguage로 fallback
  return cfg.targetLanguage || "Korean";
}

function clampText(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n(…truncated)";
}

function normalizeModelSelection(n) {
  const v = Number.parseInt(String(n), 10);
  if (v === 1 || v === 2) return v;
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTelegramRetryAfterSeconds(err) {
  const retryAfterHeader = err?.response?.headers?.["retry-after"] || err?.response?.headers?.["Retry-After"];
  const retryAfterParam = err?.response?.body?.parameters?.retry_after;
  const n1 = Number.parseInt(String(retryAfterHeader ?? ""), 10);
  if (Number.isFinite(n1) && n1 > 0) return n1;
  const n2 = Number.parseInt(String(retryAfterParam ?? ""), 10);
  if (Number.isFinite(n2) && n2 > 0) return n2;
  return null;
}

function isTelegramError(err, code) {
  return err?.code === "ETELEGRAM" && (code == null || err?.response?.body?.error_code === code || err?.response?.statusCode === code);
}

// 전송 버스트를 줄이기 위한 전역(봇 프로세스 내) send mutex + pacing
let _sendMutex = Promise.resolve();
let _nextSendAt = 0;

async function runSendExclusive(fn) {
  const prev = _sendMutex;
  let release = null;
  _sendMutex = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release?.();
  }
}

async function safeSendMessage(bot, chatId, text, options = {}) {
  // 텔레그램은 전송 rate limit(429)이 꽤 자주 발생합니다.
  // - 429: retry_after 만큼 기다렸다가 재시도
  // - 400 replied not found: reply_to_message_id 제거 후 1회 재시도
  const maxAttempts = 4;
  let lastErr = null;

  let opts = { ...options };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await runSendExclusive(async () => {
        // 너무 빠른 연속 전송을 방지(429 감소)
        const minSendIntervalMs = 1100;
        const now = Date.now();
        const waitMs = Math.max(0, _nextSendAt - now);
        if (waitMs) await sleep(waitMs);

        const res = await bot.sendMessage(chatId, text, opts);
        _nextSendAt = Date.now() + minSendIntervalMs;
        return res;
      });
    } catch (err) {
      lastErr = err;

      // reply 대상 메시지가 없으면(삭제/스레드/권한 등) reply 옵션을 제거하고 재시도
      const desc = String(err?.response?.body?.description || err?.message || "");
      if (
        isTelegramError(err, 400) &&
        opts?.reply_to_message_id &&
        desc.toLowerCase().includes("message to be replied not found")
      ) {
        opts = { ...opts };
        delete opts.reply_to_message_id;
        continue;
      }

      // rate limit: retry-after 만큼 대기 후 재시도
      if (isTelegramError(err, 429)) {
        const retryAfter = getTelegramRetryAfterSeconds(err) ?? 3;
        const jitterMs = Math.floor(Math.random() * 250);
        // 다음 전송 가능 시점을 밀어둬서, 동시 전송 폭주가 줄어들게 합니다.
        _nextSendAt = Math.max(_nextSendAt, Date.now() + retryAfter * 1000);
        console.warn(
          `[tele-translate] telegram rate limited (429). retry after ${retryAfter}s (attempt ${attempt}/${maxAttempts})`
        );
        await sleep(retryAfter * 1000 + jitterMs);
        continue;
      }

      throw err;
    }
  }

  throw lastErr;
}

async function main() {
  const lock = acquirePidLock();
  if (!lock.acquired) {
    console.error(
      `[tele-translate] already running (pid=${lock.existingPid}). ` +
        "다른 창/서비스에서 실행 중인 봇을 먼저 종료하세요."
    );
    process.exit(1);
  }

  const cfg = loadConfig();

  const request = cfg.telegram?.proxyUrl ? { proxy: cfg.telegram.proxyUrl } : undefined;
  const mode = (cfg.telegram?.mode || "polling").toLowerCase();

  // polling은 네트워크 제한(방화벽/ISP/회사망)에서 자주 끊길 수 있습니다.
  // 그런 환경에서는 proxyUrl을 주거나, webhook(이벤트) 모드로 전환할 수 있습니다.
  const bot =
    mode === "polling"
      ? new TelegramBot(cfg.telegramBotToken, { polling: true, request })
      : new TelegramBot(cfg.telegramBotToken, { request });
  
  // AI 클라이언트 생성 (Gemini 또는 OpenAI)
  const client = cfg.openaiApiKey ? createOpenAIClient(cfg.openaiApiKey) : null;
  const geminiClient = cfg.geminiApiKey ? createGeminiClient(cfg.geminiApiKey) : null;

  bot.on("polling_error", (err) => {
    // 네트워크가 잠깐 끊기면 ECONNRESET이 종종 납니다.
    // node-telegram-bot-api는 기본적으로 재시도하니, 여기서는 로깅만 하고 끝냅니다.
    console.error("[tele-translate] polling_error:", err?.message || err);
  });

  // 언어 선택 저장 (chatId별로)
  const languagePreferences = {};
  // 인식모델(= 번역/LLM 모델) 선택 저장 (chatId별로)
  // - 1: Gemini (기본, 실패 시 gpt-5.2 폴백)
  // - 2: gpt-5.2 강제
  const recognitionModelPreferences = {};

  bot.on("message", async (msg) => {
    try {
      console.log(`[message] Received message from chat ${msg.chat.id}, message_id: ${msg.message_id}`);
      
      const chatId = msg.chat.id;
      let forcedLanguage = null;
      let forcedRecognitionModel = null;
      
      // 저장된 언어 선호도 확인
      if (languagePreferences[chatId]) {
        forcedLanguage = languagePreferences[chatId];
      }
      if (recognitionModelPreferences[chatId]) {
        forcedRecognitionModel = recognitionModelPreferences[chatId];
      }
      
      // 메시지에 언어 정보가 있는지 확인 (Telegram의 언어 선택 버튼)
      if (msg.language_code) {
        if (msg.language_code === "km") {
          forcedLanguage = "Khmer";
          languagePreferences[chatId] = "Khmer";
        } else if (msg.language_code === "vi") {
          forcedLanguage = "Vietnamese";
          languagePreferences[chatId] = "Vietnamese";
        }
      }
      
      if (!shouldProcessMessage(msg, cfg)) {
        const reason = isEmojiOnly(msg.text) ? "emoji-only" : "filtered";
        console.log(`[message] Message filtered out (reason: ${reason}, chatId: ${msg.chat.id}, text: ${msg.text?.substring(0, 50)})`);
        return;
      }

      const original = clampText(msg.text, cfg.maxInputChars);
      // 답글 메시지의 텍스트 추출 (특수문자/이모지가 있어도 처리)
      let replyText = null;
      if (msg?.reply_to_message) {
        replyText = typeof msg.reply_to_message.text === "string" 
          ? msg.reply_to_message.text 
          : (typeof msg.reply_to_message.caption === "string" 
            ? msg.reply_to_message.caption 
            : null);
      }
      const targetLanguage = pickTargetLanguage(cfg, original, replyText, forcedLanguage);

      const script = detectScript(original, cfg.assumeLatinIsVietnamese !== false);
      console.log(`[message] Processing: "${original.substring(0, 50)}..." => ${targetLanguage}${forcedLanguage ? ` (forced: ${forcedLanguage})` : ''} [script: ${script}${replyText ? `, reply: "${replyText.substring(0, 30)}..."` : ''}]`);

      const resolvedModel =
        forcedRecognitionModel === 2 ? "gpt-5.2" : cfg.model;
      const resolvedFallbackModel = cfg.fallbackModel;

      // 간단 중복 방지: 같은 메시지에 대해 여러 번 처리되지 않게
      // (텔레그램 업데이트 재전송/재시작 시 케이스 대비)
      const key = `${chatId}:${msg.message_id}`;
      if (main._seen?.has(key)) {
        console.log(`[message] Duplicate message ignored: ${key}`);
        return;
      }
      if (!main._seen) main._seen = new Set();
      main._seen.add(key);
      if (main._seen.size > 3000) main._seen.clear();

      console.log(`[message] Translating to ${targetLanguage}...`);
      const translated = await translateText({
        client,
        geminiClient,
        model: resolvedModel,
        fallbackModel: resolvedFallbackModel,
        systemPrompt: cfg.systemPrompt,
        targetLanguage,
        text: original,
      });

      if (!translated || !translated.trim()) {
        console.log(`[message] Translation returned empty, skipping`);
        return;
      }

      // 번역 결과가 원문과 너무 유사하면 번역 실패로 간주
      const translatedClean = translated.trim();
      const originalClean = original.trim();
      if (translatedClean === originalClean && script !== "unknown") {
        console.log(`[message] Translation result same as original, may be translation failure`);
        // 원문과 같으면 번역 실패로 간주하고 재시도하지 않음 (무한 루프 방지)
        return;
      }

      console.log(`[message] Translation result: "${translated.substring(0, 50)}..."`);
      await safeSendMessage(bot, chatId, translated, {
        reply_to_message_id: msg.message_id,
        disable_web_page_preview: true,
      });
      console.log(`[message] Message sent successfully`);
    } catch (err) {
      // 에러 객체 전체를 찍으면 request/response 덤프가 너무 커서 로그가 오히려 보기 어려워집니다.
      console.error(
        `[message] Error processing message: ${err?.code || ""} ${err?.message || err}`
      );
      if (err?.response?.body?.description) {
        console.error(`[message] Telegram description: ${err.response.body.description}`);
      }
    }
  });

  bot.onText(/\/ping/, async (msg) => {
    try {
      await safeSendMessage(bot, msg.chat.id, "pong", { reply_to_message_id: msg.message_id });
    } catch (err) {
      console.error(`[ping] failed: ${err?.code || ""} ${err?.message || err}`);
    }
  });

  // 언어 선택 명령어 처리
  bot.onText(/\/언어\s*(\d+)?/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const langOption = match[1] ? parseInt(match[1]) : null;

      if (langOption === 1) {
        // 언어 1 = 크메르어
        languagePreferences[chatId] = "Khmer";
        await safeSendMessage(bot, chatId, "크메르어로 번역하도록 설정되었습니다.", {
          reply_to_message_id: msg.message_id,
        });
      } else if (langOption === 2) {
        // 언어 2 = 베트남어
        languagePreferences[chatId] = "Vietnamese";
        await safeSendMessage(bot, chatId, "베트남어로 번역하도록 설정되었습니다.", {
          reply_to_message_id: msg.message_id,
        });
      } else {
        // 언어 선택 안내
        await safeSendMessage(
          bot,
          chatId,
          "언어 선택:\n" +
            "/언어 1 - 크메르어로 번역\n" +
            "/언어 2 - 베트남어로 번역\n" +
            "언어를 선택하지 않으면 자동 감지됩니다.",
          { reply_to_message_id: msg.message_id }
        );
      }
    } catch (err) {
      console.error(`[언어] failed: ${err?.code || ""} ${err?.message || err}`);
    }
  });

  // 인식모델(= 번역/LLM 모델) 선택 명령어 처리
  bot.onText(/\/인식모델\s*(\d+)?/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const option = normalizeModelSelection(match?.[1]);

      if (option === 1) {
        // /인식모델 1 = Gemini (기본, 실패 시 gpt-5.2 폴백)
        if (!cfg.geminiApiKey) {
          await safeSendMessage(
            bot,
            chatId,
            "Gemini API 키가 설정되어 있지 않아 /인식모델 1(Gemini)을 사용할 수 없습니다.",
            { reply_to_message_id: msg.message_id }
          );
          return;
        }
        // 기본 설정 사용(= Gemini 우선 + 폴백)은 별도 강제값을 저장하지 않습니다.
        delete recognitionModelPreferences[chatId];
        const fallback = cfg.fallbackModel || "gpt-5.2";
        await safeSendMessage(
          bot,
          chatId,
          `인식모델 1로 설정되었습니다. (기본: ${cfg.model}${fallback ? `, 폴백: ${fallback}` : ""})`,
          { reply_to_message_id: msg.message_id }
        );
        return;
      }

      if (option === 2) {
        // /인식모델 2 = gpt-5.2 강제
        if (!cfg.openaiApiKey) {
          await safeSendMessage(
            bot,
            chatId,
            "OpenAI API 키가 설정되어 있지 않아 /인식모델 2(gpt-5.2)을 사용할 수 없습니다.",
            { reply_to_message_id: msg.message_id }
          );
          return;
        }
        recognitionModelPreferences[chatId] = 2;
        await safeSendMessage(bot, chatId, "인식모델 2로 설정되었습니다. (gpt-5.2)", {
          reply_to_message_id: msg.message_id,
        });
        return;
      }

      // 안내 + 현재 상태
      const currentForced = recognitionModelPreferences[chatId] || 1;
      const fallback = cfg.fallbackModel || "gpt-5.2";
      await safeSendMessage(
        bot,
        chatId,
        "인식모델 선택:\n" +
          `/인식모델 1 - 기본 설정 사용 (기본: ${cfg.model}${fallback ? `, 폴백: ${fallback}` : ""})\n` +
          "/인식모델 2 - gpt-5.2\n\n" +
          `현재 설정: /인식모델 ${currentForced}`,
        { reply_to_message_id: msg.message_id }
      );
    } catch (err) {
      console.error(`[인식모델] failed: ${err?.code || ""} ${err?.message || err}`);
    }
  });

  if (mode === "webhook") {
    const webhook = cfg.telegram?.webhook || {};
    const publicUrl = webhook.publicUrl;
    if (!publicUrl) {
      throw new Error(
        'telegram.mode="webhook" 인데 telegram.webhook.publicUrl 이 없습니다. (예: https://xxxx.ngrok-free.app)'
      );
    }

    const path = webhook.path || "/telegram-webhook";
    const fullUrl = String(publicUrl).replace(/\/+$/, "") + path;

    const app = express();
    app.use(express.json({ limit: "2mb" }));
    
    // 요청 로깅 미들웨어
    app.use((req, res, next) => {
      console.log(`[webhook] ${req.method} ${req.path} from ${req.ip}`);
      next();
    });
    
    app.post(path, (req, res) => {
      const update = req.body;
      console.log(`[webhook] Received update ID: ${update.update_id}`);
      
      if (update.message) {
        console.log(`[webhook] Message from chat ${update.message.chat.id}, text: "${update.message.text?.substring(0, 50)}"`);
      } else {
        console.log(`[webhook] Update type: ${Object.keys(update).filter(k => k !== 'update_id').join(', ')}`);
      }
      
      try {
        bot.processUpdate(update);
        console.log(`[webhook] Update ${update.update_id} processed successfully`);
        res.sendStatus(200);
      } catch (err) {
        console.error(`[webhook] Error processing update ${update.update_id}:`, err);
        console.error(`[webhook] Error stack:`, err.stack);
        res.status(500).send('Error processing update');
      }
    });

    await bot.setWebHook(fullUrl);

    const host = webhook.host || "127.0.0.1";
    const port = webhook.port || 58010;
    const certPath = webhook.certPath;
    const keyPath = webhook.keyPath;

    // HTTPS 인증서가 있으면 HTTPS 서버로 시작
    if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const options = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
      https.createServer(options, app).listen(port, host, () => {
        console.log(`[tele-translate] HTTPS webhook server listening on https://${host}:${port}${path}`);
        console.log(`[tele-translate] webhook set: ${fullUrl}`);
      });
    } else {
      // 인증서가 없으면 HTTP로 시작 (개발용)
      app.listen(port, host, () => {
        console.log(`[tele-translate] HTTP webhook server listening on http://${host}:${port}${path}`);
        console.log(`[tele-translate] webhook set: ${fullUrl}`);
        if (!certPath || !keyPath) {
          console.warn(`[tele-translate] 경고: 인증서 경로가 설정되지 않았습니다. HTTPS를 사용하려면 certPath와 keyPath를 설정하세요.`);
        } else {
          console.warn(`[tele-translate] 경고: 인증서 파일을 찾을 수 없습니다. (certPath: ${certPath}, keyPath: ${keyPath})`);
        }
      });
    }
  }

  // 시작 로그
  const langInfo = `ko->${cfg.koreanTo}, vi->${cfg.vietnameseTo}, km->${cfg.khmerTo || "Korean"}`;
  console.log(
    `[tele-translate] running. mode=${mode}, model=${cfg.model}, autoTranslate=${
      cfg.autoTranslate ? "on" : "off"
    }` +
      `, ${langInfo}` +
      (Array.isArray(cfg.allowedChatIds) && cfg.allowedChatIds.length > 0
        ? `, allowedChatIds=${cfg.allowedChatIds.join(",")}`
        : ", allowedChatIds=ALL")
  );
}

main().catch((e) => {
  console.error("[tele-translate] fatal:", e?.message || e);
  process.exit(1);
});


