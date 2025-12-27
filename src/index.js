const TelegramBot = require("node-telegram-bot-api");
const { loadConfig } = require("./config");
const { createOpenAIClient, translateText } = require("./openaiClient");
const { acquirePidLock } = require("./pidLock");
const express = require("express");
const https = require("https");
const fs = require("fs");

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

  return true;
}

function detectScript(text) {
  // 아주 단순 판별(고급 언어감지는 아님)
  // - hangul: 가-힣
  // - khmer: U+1780–U+17FF (Khmer)
  const hasHangul = /[\uAC00-\uD7A3]/.test(text);
  const hasKhmer = /[\u1780-\u17FF]/.test(text);
  if (hasHangul && !hasKhmer) return "hangul";
  if (hasKhmer && !hasHangul) return "khmer";
  if (hasHangul && hasKhmer) return "mixed";
  return "unknown";
}

function pickTargetLanguage(cfg, text, replyText) {
  if (!cfg.autoTranslate) return cfg.targetLanguage || "Korean";

  const script = detectScript(text);
  if (script === "hangul") return cfg.koreanTo; // 한글 -> 크메르어
  if (script === "khmer") return cfg.khmerTo; // 크메르어 -> 한글

  // 답글(Reply)이고 현재 메시지가 애매하면, "답글 대상 메시지"를 기준으로 방향을 추정합니다.
  // 예)
  // - 답글 대상이 한국어(한글)이면: 보통 상대는 크메르어로 답하므로 => 한국어로 번역(khmerTo)
  // - 답글 대상이 크메르어면: 보통 상대는 한국어로 답하므로 => 크메르어로 번역(koreanTo)
  if (typeof replyText === "string" && replyText.trim()) {
    const replyScript = detectScript(replyText);
    if (replyScript === "hangul") return cfg.khmerTo; // (추정) 크메르어 -> 한글
    if (replyScript === "khmer") return cfg.koreanTo; // (추정) 한글 -> 크메르어
  }

  // 섞였거나 애매하면, 기존 targetLanguage로 fallback
  return cfg.targetLanguage || "Korean";
}

function clampText(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n(…truncated)";
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
  const client = createOpenAIClient(cfg.openaiApiKey);

  bot.on("polling_error", (err) => {
    // 네트워크가 잠깐 끊기면 ECONNRESET이 종종 납니다.
    // node-telegram-bot-api는 기본적으로 재시도하니, 여기서는 로깅만 하고 끝냅니다.
    console.error("[tele-translate] polling_error:", err?.message || err);
  });

  bot.on("message", async (msg) => {
    try {
      if (!shouldProcessMessage(msg, cfg)) return;

      const chatId = msg.chat.id;
      const original = clampText(msg.text, cfg.maxInputChars);
      const replyText =
        typeof msg?.reply_to_message?.text === "string" ? msg.reply_to_message.text : null;
      const targetLanguage = pickTargetLanguage(cfg, original, replyText);

      // 간단 중복 방지: 같은 메시지에 대해 여러 번 처리되지 않게
      // (텔레그램 업데이트 재전송/재시작 시 케이스 대비)
      const key = `${chatId}:${msg.message_id}`;
      if (main._seen?.has(key)) return;
      if (!main._seen) main._seen = new Set();
      main._seen.add(key);
      if (main._seen.size > 3000) main._seen.clear();

      const translated = await translateText({
        client,
        model: cfg.model,
        systemPrompt: cfg.systemPrompt,
        targetLanguage,
        text: original,
      });

      if (!translated) return;

      await bot.sendMessage(chatId, translated, {
        reply_to_message_id: msg.message_id,
        disable_web_page_preview: true,
      });
    } catch (err) {
      // 조용히 실패(토큰/키 문제 포함). 필요하면 여기서 채팅으로 에러 출력 가능.
      // console.error(err);
    }
  });

  bot.onText(/\/ping/, async (msg) => {
    await bot.sendMessage(msg.chat.id, "pong", { reply_to_message_id: msg.message_id });
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
      console.log(`[webhook] Received update:`, JSON.stringify(req.body, null, 2));
      try {
        bot.processUpdate(req.body);
        res.sendStatus(200);
      } catch (err) {
        console.error(`[webhook] Error processing update:`, err);
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
  console.log(
    `[tele-translate] running. mode=${mode}, model=${cfg.model}, autoTranslate=${
      cfg.autoTranslate ? "on" : "off"
    }` +
      `, ko->${cfg.koreanTo}, km->${cfg.khmerTo}` +
      (Array.isArray(cfg.allowedChatIds) && cfg.allowedChatIds.length > 0
        ? `, allowedChatIds=${cfg.allowedChatIds.join(",")}`
        : ", allowedChatIds=ALL")
  );
}

main().catch((e) => {
  console.error("[tele-translate] fatal:", e?.message || e);
  process.exit(1);
});


