// 번역봇이 남기는 covert-chats.json 을 주기적으로 읽어 거래를 자동 추출한다.
//
// 번역봇(lnteletranslate-tra)은 전혀 건드리지 않는다. 그 봇이 이미 원문/번역을 이 파일에
// 쌓고 있으므로, 파일만 읽으면 privacy mode 변경도 그룹 초대도 필요 없다.
//
// 추출한 것은 곧바로 저장하지 않는다. status='pending' 으로 넣고 DM 으로 확인을 받는다.
// (실측: 금액이 언급된 메시지 중 실제 거래는 15% 뿐이라 자동 저장은 장부를 망친다)

const fs = require("fs");

const db = require("./db");
const dates = require("./dates");
const fmt = require("./format");
const { hasMoneySignal, classifyBatch } = require("./extract");
const { guessCurrency, toUsd } = require("./currency");

const BATCH_SIZE = 10;

function readSourceFile(path) {
  try {
    if (!fs.existsSync(path)) return null;
    const raw = JSON.parse(fs.readFileSync(path, "utf8"));
    return Array.isArray(raw.chats) ? raw.chats : [];
  } catch (err) {
    return { error: err };
  }
}

/** 사진/이모티콘 신호처럼 본문이 없는 항목은 제외한다. */
function isTextEntry(chat) {
  if (!chat || !chat.id) return false;
  if (chat.sourceScript === "signal") return false;
  return Boolean(String(chat.original || "").trim());
}

function buildPendingKeyboard(entryId, currencyGuessed) {
  const rows = [
    [
      { text: "✅ 🏠 home 저장", callback_data: `okb:${entryId}:home` },
      { text: "🏢 office 저장", callback_data: `okb:${entryId}:office` },
    ],
    [{ text: "❌ 무시", callback_data: `v:${entryId}` }],
  ];
  if (currencyGuessed) {
    rows.unshift(
      ["USD", "KHR", "KRW"].map((cur) => ({
        text: `${fmt.SYMBOL[cur]} ${cur}`,
        callback_data: `c:${entryId}:${cur}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

function buildPendingText(row, { chat, verdict, duplicate, currencyGuessed }) {
  const money = fmt.formatWithUsd(Number(row.amount), row.currency, Number(row.amount_usd));
  const quote = (chat.translated || chat.original || "").slice(0, 120);

  const lines = [
    `💰 <b>대화에서 발견</b> · 확신도 ${verdict.confidence.toFixed(2)}`,
    `${fmt.DIRECTION_LABEL[row.direction]} ${fmt.DIRECTION_SIGN[row.direction]}${fmt.escapeHtml(money)}` +
      (row.memo ? ` "${fmt.escapeHtml(row.memo)}"` : ""),
    `<i>“${fmt.escapeHtml(quote)}”</i>`,
    `<i>${row.occurred_at instanceof Date ? dates.toDateString(row.occurred_at) : row.occurred_at}</i>`,
  ];

  if (currencyGuessed) {
    lines.push(`⚠️ 통화 표기가 없어 <b>${row.currency}</b> 로 추정했습니다.`);
  }

  if (duplicate) {
    const dupMoney = fmt.formatMoney(Number(duplicate.amount), duplicate.currency);
    lines.push(
      `⚠️ <b>#${duplicate.id} 와 중복 가능</b> — ${fmt.escapeHtml(dupMoney)}` +
        (duplicate.memo ? ` "${fmt.escapeHtml(duplicate.memo)}"` : "")
    );
  }

  return lines.join("\n");
}

/**
 * @param {object} opts
 * @param {object} opts.cfg
 * @param {(text:string, keyboard:object)=>Promise<any>} opts.notify - 확인 메시지 전송
 * @param {(...args:any)=>void} opts.log
 */
function createWatcher({ cfg, notify, log }) {
  const auto = cfg.autoExtract;
  let primed = false;
  let running = false;

  async function processCandidates(candidates) {
    let recorded = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);

      let verdicts;
      try {
        verdicts = await classifyBatch(cfg, batch.map((c) => ({ original: c.original, translated: c.translated })));
      } catch (err) {
        log("[auto] 판정 실패, 이번 배치는 다음에 다시 시도:", err.message);
        continue; // seen 으로 표시하지 않아 다음 폴링에서 재시도된다
      }

      // 한 메시지에서 여러 거래가 나올 수 있으므로 index 별로 모은다.
      const byIndex = new Map();
      for (const verdict of verdicts) {
        if (!byIndex.has(verdict.index)) byIndex.set(verdict.index, []);
        byIndex.get(verdict.index).push(verdict);
      }

      for (let j = 0; j < batch.length; j += 1) {
        const chat = batch[j];
        const hits = (byIndex.get(j) || []).filter(
          (v) => v.isTransaction && v.amount && v.direction && v.confidence >= auto.minConfidence
        );

        let lastEntryId = null;
        for (const verdict of hits) {
          try {
            lastEntryId = await createPending(chat, verdict);
            if (lastEntryId) recorded += 1;
          } catch (err) {
            log("[auto] 기록 실패:", err.message);
          }
        }

        await db.markSourceSeen(chat.id, chat.ts, lastEntryId);
      }
    }

    return recorded;
  }

  async function createPending(chat, verdict) {
    const currencyGuessed = !verdict.currency;
    const currency = verdict.currency || guessCurrency(verdict.amount, cfg.defaultCurrency, verdict.direction);
    const { ratePerUsd, amountUsd } = toUsd(verdict.amount, currency, cfg.fx);
    const occurredAt = dates.toDateString(new Date(chat.ts || Date.now()));

    const entryId = await db.insertEntry({
      book: cfg.chatBooks[String(chat.chatId)] || cfg.defaultBook,
      direction: verdict.direction,
      amount: verdict.amount,
      currency,
      ratePerUsd,
      amountUsd,
      memo: verdict.memo,
      occurredAt,
      source: "auto",
      confidence: verdict.confidence,
      tgChatId: chat.chatId ?? null,
      tgMessageId: null, // 대화 로그에는 메시지 번호가 없다
      rawText: chat.original,
      status: "pending",
    });

    const row = await db.getEntry(entryId);
    const duplicate = await db.findPossibleDuplicate({
      amount: verdict.amount,
      currency,
      withinHours: auto.duplicateWindowHours,
      excludeId: entryId,
    });

    await notify(
      buildPendingText(row, { chat, verdict, duplicate, currencyGuessed }),
      buildPendingKeyboard(entryId, currencyGuessed)
    );

    log(
      `[auto] pending #${entryId} ${verdict.direction} ${verdict.amount}${currency} conf=${verdict.confidence}` +
        (duplicate ? ` (중복의심 #${duplicate.id})` : "")
    );
    return entryId;
  }

  async function tick() {
    if (running) return; // 이전 폴링이 아직 AI 를 기다리는 중
    running = true;

    try {
      const chats = readSourceFile(auto.sourceFile);
      if (chats === null) {
        log(`[auto] 대화 파일이 없습니다: ${auto.sourceFile}`);
        return;
      }
      if (chats.error) {
        // 번역봇이 쓰는 도중에 읽으면 깨진 JSON 을 볼 수 있다. 다음 폴링에서 다시 읽는다.
        return;
      }

      const texts = chats.filter(isTextEntry);

      // 첫 실행에 파일에 남아 있던 과거 대화를 한꺼번에 물어보면 곤란하다.
      if (!primed && !auto.processBacklogOnStart) {
        for (const chat of texts) await db.markSourceSeen(chat.id, chat.ts);
        primed = true;
        log(`[auto] 최초 실행 — 기존 ${texts.length}건은 처리하지 않고 건너뜁니다.`);
        return;
      }
      primed = true;

      const candidates = texts.filter((chat) => hasMoneySignal(`${chat.original} ${chat.translated}`));
      if (!candidates.length) return;

      const unseenIds = new Set(await db.filterUnseenSourceIds(candidates.map((c) => c.id)));
      const fresh = candidates.filter((c) => unseenIds.has(c.id));
      if (!fresh.length) return;

      log(`[auto] 금액 단서 ${fresh.length}건 판정 시작`);
      const recorded = await processCandidates(fresh);
      log(`[auto] 판정 완료 — ${recorded}건을 확인 대기로 올렸습니다.`);

      await db.pruneSourceSeen();
    } catch (err) {
      log("[auto] 폴링 오류:", err.stack || err.message);
    } finally {
      running = false;
    }
  }

  return { tick };
}

function startWatcher({ cfg, notify, log }) {
  const watcher = createWatcher({ cfg, notify, log });
  const intervalMs = Math.max(30, cfg.autoExtract.pollSeconds) * 1000;

  log(
    `[auto] 자동 추출 ON — ${cfg.autoExtract.sourceFile} 를 ${cfg.autoExtract.pollSeconds}초마다 확인 (최소 확신도 ${cfg.autoExtract.minConfidence})`
  );

  setTimeout(() => watcher.tick(), 5000).unref?.();
  const timer = setInterval(() => watcher.tick(), intervalMs);
  timer.unref?.();
  return watcher;
}

module.exports = { startWatcher, createWatcher, isTextEntry, buildPendingKeyboard, buildPendingText };
