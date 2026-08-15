const TelegramBot = require("node-telegram-bot-api");

const { loadConfig, BOOKS, CURRENCIES } = require("./config");
const db = require("./db");
const dates = require("./dates");
const fmt = require("./format");
const { parseAmountExpr, guessCurrency, toUsd } = require("./currency");
const { renderSummary, netOf } = require("./summary");
const { interpret, extractRecords } = require("./ai");
const { startWatcher } = require("./watcher");
const { chat, splitForTelegram } = require("./chat");

const cfg = loadConfig();

const BOOK_TAG = new Map([
  ["home", "home"], ["홈", "home"], ["집", "home"],
  ["office", "office"], ["오피스", "office"], ["사무실", "office"], ["회사", "office"],
]);

const DIRECTION_BY_COMMAND = new Map([
  ["buy", "expense"], ["지출", "expense"], ["spend", "expense"], ["사용", "expense"],
  ["send", "transfer"], ["송금", "transfer"],
  ["add", "income"], ["수입", "income"], ["income", "income"], ["입금", "income"],
]);

const QUANTITY_RE = /(\d+)\s*(대|개|장|병|박스|잔|명|켤레|kg|box)/i;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---------------------------------------------------------------- 접근 제어

/** ownerUserIds 가 비어 있으면 아직 설정 전이라는 뜻. 기록은 막고 ID 만 알려준다. */
function isBootstrapping() {
  return cfg.ownerUserIds.length === 0;
}

function isOwner(userId) {
  return cfg.ownerUserIds.includes(Number(userId));
}

function isAllowedChat(chatId) {
  if (cfg.allowedChatIds.length === 0) return true;
  return cfg.allowedChatIds.includes(Number(chatId));
}

// ---------------------------------------------------------------- 인자 해석

/** 메모 어디에 있든 #home / #사무실 태그를 뽑아내고 본문에서 제거한다. */
function extractBookTag(text) {
  let book = null;
  const cleaned = text.replace(/#([A-Za-z가-힣]+)/g, (match, tag) => {
    const mapped = BOOK_TAG.get(tag.toLowerCase());
    if (!mapped) return match;
    book = mapped;
    return "";
  });
  return { book, text: cleaned.replace(/\s{2,}/g, " ").trim() };
}

/** @2026-08-10 / @08-10 형태의 날짜 지정을 뽑아낸다. */
function extractDate(text) {
  let occurredAt = null;
  const cleaned = text.replace(/@(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2})/g, (match, raw) => {
    const parts = raw.split("-").map(Number);
    const now = new Date();
    const [y, m, d] = parts.length === 3 ? parts : [now.getFullYear(), parts[0], parts[1]];
    occurredAt = `${y}-${dates.pad2(m)}-${dates.pad2(d)}`;
    return "";
  });
  return { occurredAt, text: cleaned.replace(/\s{2,}/g, " ").trim() };
}

async function resolveBook(chatId, explicitBook) {
  if (explicitBook) return explicitBook;
  const setting = await db.getChatSetting(chatId);
  if (setting?.active_book) return setting.active_book;
  return cfg.chatBooks[String(chatId)] || cfg.defaultBook;
}

async function resolveDefaultCurrency(chatId) {
  const setting = await db.getChatSetting(chatId);
  return setting?.default_currency || cfg.defaultCurrency;
}

// ---------------------------------------------------------------- 메시지 조립

async function bookMonthNet(book) {
  const period = dates.currentMonthRange();
  const rows = await db.sumByBook(period);
  const bucket = { income: 0, expense: 0, transfer: 0 };
  for (const row of rows) {
    if (row.book !== book) continue;
    bucket[row.direction] = Number(row.total_usd) || 0;
  }
  return { net: netOf(bucket), label: period.label };
}

function buildEntryKeyboard(row, { currencyGuessed }) {
  const otherBook = row.book === "home" ? "office" : "home";
  const keyboard = [
    [
      { text: `${otherBook === "office" ? "🏢" : "🏠"} ${otherBook}로 이동`, callback_data: `b:${row.id}:${otherBook}` },
      { text: "❌ 취소", callback_data: `v:${row.id}` },
    ],
  ];

  if (currencyGuessed) {
    const others = CURRENCIES.filter((c) => c !== row.currency);
    keyboard.unshift(
      others.map((cur) => ({ text: `${fmt.SYMBOL[cur]} ${cur}로 정정`, callback_data: `c:${row.id}:${cur}` }))
    );
  }

  return { inline_keyboard: keyboard };
}

async function buildEntryText(row, { currencyGuessed = false } = {}) {
  const icon = row.book === "office" ? "🏢" : "🏠";
  const sign = fmt.DIRECTION_SIGN[row.direction];
  const money = fmt.formatWithUsd(Number(row.amount), row.currency, Number(row.amount_usd));
  const memo = row.memo ? `\n"${fmt.escapeHtml(row.memo)}"` : "";
  const { net, label } = await bookMonthNet(row.book);
  const netText = `${net < 0 ? "−" : ""}${fmt.formatUsd(Math.abs(net))}`;

  const head = row.status === "void" ? "🚫 취소됨" : "✅ 기록";
  const warn = currencyGuessed
    ? `\n⚠️ 통화를 <b>${row.currency}</b> 로 추정했습니다. 다르면 아래 버튼으로 정정하세요.`
    : "";

  return (
    `${head} <b>#${row.id}</b> · ${icon} ${row.book.toUpperCase()}\n` +
    `${fmt.DIRECTION_LABEL[row.direction]} ${sign}${fmt.escapeHtml(money)}${memo}\n` +
    `<i>${row.occurred_at instanceof Date ? dates.toDateString(row.occurred_at) : row.occurred_at} · ${label} ${row.book.toUpperCase()} 잔액 ${netText}</i>` +
    warn
  );
}

// ---------------------------------------------------------------- 명령 처리

const USAGE = [
  "<b>가계부 명령</b>",
  "",
  "<code>/buy 120 pc 2대</code> — 지출",
  "<code>/send 200 엄마</code> — 송금",
  "<code>/add 1500 월급</code> — 수입",
  "",
  "금액에 통화를 붙일 수 있습니다:",
  "<code>120</code> 또는 <code>$120</code> → USD",
  "<code>50000r</code> <code>50000리엘</code> → KHR",
  "<code>15000원</code> <code>1.5만원</code> → KRW",
  "",
  "가계부 분리: 메모에 <code>#home</code> / <code>#office</code>",
  "날짜 지정: <code>@2026-08-10</code> 또는 <code>@08-10</code>",
  "",
  "<code>/showcalc</code> — 이번달 집계표 (home·office)",
  "<code>/showcalc office</code> · <code>/showcalc 2026-07</code>",
  "<code>/bal</code> — 이번달 잔액",
  "<code>/list 10</code> — 최근 기록 (🗑 버튼으로 건별 삭제)",
  "<code>/list 20 office</code> — office 것만",
  "<code>/book office</code> — 이 방의 기본 가계부 변경",
  "<code>/del 142</code> — 기록 취소",
  "<code>/undo</code> — 방금 취소한 기록 복구",
  "",
  "명령이 아닌 말은 그냥 하시면 됩니다.",
  "<i>“어제 시장에서 5만리엘 썼어”</i> → 기록",
  "<i>“홈 수입 $250 추가, 후 지출 $100 아버지오토바이”</i> → 2건 한 번에 기록",
  "<i>“지금 입력분 삭제해줘”</i> → 취소",
  "",
  "그 외의 말은 대화로 받습니다.",
  "<code>/저장</code> (<code>/aiok</code>) — 직전 대화 내용을 그대로 장부에 기록",
  "<code>/reset</code> — 대화 맥락 지우기",
].join("\n");

/** 명령어 경로와 AI 경로가 공유하는 기록 저장부. */
async function saveAndReply(bot, msg, input) {
  const chatId = msg.chat.id;
  const book = input.book || (await resolveBook(chatId, null));
  const defaultCurrency = await resolveDefaultCurrency(chatId);

  const currencyGuessed = !input.currency;
  const currency = input.currency || guessCurrency(input.amount, defaultCurrency, input.direction);
  const { ratePerUsd, amountUsd } = toUsd(input.amount, currency, cfg.fx);

  const memo = input.memo || null;
  const quantityMatch = memo ? QUANTITY_RE.exec(memo) : null;

  let entryId;
  try {
    entryId = await db.insertEntry({
      book,
      direction: input.direction,
      amount: input.amount,
      currency,
      ratePerUsd,
      amountUsd,
      memo,
      quantity: quantityMatch ? Number(quantityMatch[1]) : null,
      occurredAt: input.occurredAt || dates.today(),
      source: "command",
      tgChatId: chatId,
      tgMessageId: input.skipMessageId ? null : msg.message_id,
      tgUserId: msg.from?.id ?? null,
      tgUserName: msg.from?.first_name ?? null,
      rawText: msg.text,
      status: "active",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      await bot.sendMessage(chatId, "이미 기록된 메시지입니다.");
      return null;
    }
    throw err;
  }

  const row = await db.getEntry(entryId);
  const body = await buildEntryText(row, { currencyGuessed });
  await bot.sendMessage(chatId, input.prefix ? `${input.prefix}\n\n${body}` : body, {
    parse_mode: "HTML",
    reply_markup: buildEntryKeyboard(row, { currencyGuessed }),
  });

  log(`[record] #${entryId} ${book}/${input.direction} ${input.amount}${currency} chat=${chatId}`);
  return row;
}

async function handleRecord(bot, msg, direction, rawArgs) {
  const chatId = msg.chat.id;

  if (!rawArgs || !rawArgs.trim()) {
    await bot.sendMessage(chatId, USAGE, { parse_mode: "HTML" });
    return;
  }

  const bookTag = extractBookTag(rawArgs);
  const dateTag = extractDate(bookTag.text);
  const parsed = parseAmountExpr(dateTag.text);

  if (!parsed) {
    await bot.sendMessage(
      chatId,
      `금액을 읽지 못했습니다: <code>${fmt.escapeHtml(rawArgs)}</code>\n\n${USAGE}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  await saveAndReply(bot, msg, {
    direction,
    amount: parsed.amount,
    currency: parsed.currency,
    book: bookTag.book || null,
    memo: parsed.rest || null,
    occurredAt: dateTag.occurredAt,
  });
}

async function handleShowCalc(bot, msg, rawArgs) {
  const tokens = String(rawArgs || "").trim().split(/\s+/).filter(Boolean);

  let onlyBook = null;
  let periodToken = null;
  for (const token of tokens) {
    const asBook = BOOK_TAG.get(token.replace(/^#/, "").toLowerCase());
    if (asBook) onlyBook = asBook;
    else periodToken = token;
  }

  const period = dates.resolvePeriod(periodToken);
  if (!period) {
    await bot.sendMessage(
      msg.chat.id,
      "기간을 읽지 못했습니다. <code>/showcalc</code>, <code>/showcalc office</code>, <code>/showcalc 2026-07</code> 형식으로 써주세요.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const text = await renderSummary(period, cfg.fx, onlyBook);
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
}

async function handleBalance(bot, msg) {
  const period = dates.currentMonthRange();
  const rows = await db.sumByBook(period);
  const buckets = { home: { income: 0, expense: 0, transfer: 0 }, office: { income: 0, expense: 0, transfer: 0 } };
  for (const row of rows) {
    if (!buckets[row.book]) continue;
    buckets[row.book][row.direction] = Number(row.total_usd) || 0;
  }

  const lines = BOOKS.map((book) => {
    const net = netOf(buckets[book]);
    const icon = book === "office" ? "🏢" : "🏠";
    return `${icon} ${book.toUpperCase()} · ${net < 0 ? "−" : ""}${fmt.formatUsd(Math.abs(net))}`;
  });

  const total = BOOKS.reduce((acc, book) => acc + netOf(buckets[book]), 0);
  lines.push(`합계 · <b>${total < 0 ? "−" : ""}${fmt.formatUsd(Math.abs(total))}</b>`);

  await bot.sendMessage(msg.chat.id, `💰 <b>${period.label} 잔액</b>\n${lines.join("\n")}`, {
    parse_mode: "HTML",
  });
}

/** 목록 + 건별 삭제 버튼. 삭제 후 같은 메시지를 다시 그리기 위해 따로 뺐다. */
async function buildListView({ limit, book }) {
  const rows = await db.listEntries({ book, limit });
  const scope = book ? ` · ${book.toUpperCase()}` : "";

  if (!rows.length) {
    return { text: `🧾 <b>최근 기록</b>${scope}\n기록이 없습니다.`, keyboard: { inline_keyboard: [] } };
  }

  const body = rows.map((row) => fmt.escapeHtml(fmt.formatEntryLine(row))).join("\n");
  const bookToken = book || "-";

  // callback_data 는 64바이트 제한이 있어 번호만 싣는다.
  const buttons = [];
  for (let i = 0; i < rows.length; i += 3) {
    buttons.push(
      rows.slice(i, i + 3).map((row) => ({
        text: `🗑 ${row.id}`,
        callback_data: `lv:${row.id}:${limit}:${bookToken}`,
      }))
    );
  }

  return {
    text: `🧾 <b>최근 ${rows.length}건</b>${scope}\n<i>🗑 버튼으로 건별 삭제 (복구는 /undo)</i>\n\n${body}`,
    keyboard: { inline_keyboard: buttons },
  };
}

function parseListArgs(rawArgs) {
  const tokens = String(rawArgs || "").trim().split(/\s+/).filter(Boolean);
  let limit = 10;
  let book = null;
  for (const token of tokens) {
    const asBook = BOOK_TAG.get(token.replace(/^#/, "").toLowerCase());
    if (asBook) book = asBook;
    else if (/^\d+$/.test(token)) limit = Math.min(Math.max(Number(token), 1), 30);
  }
  return { limit, book };
}

async function handleList(bot, msg, rawArgs) {
  const { limit, book } = parseListArgs(rawArgs);
  const view = await buildListView({ limit, book });
  await bot.sendMessage(msg.chat.id, view.text, {
    parse_mode: "HTML",
    reply_markup: view.keyboard,
  });
}

async function handleUndo(bot, msg) {
  const row = await db.lastVoidedEntry();
  if (!row) {
    await bot.sendMessage(msg.chat.id, "복구할 기록이 없습니다.");
    return;
  }
  await db.restoreEntry(row.id);
  const restored = await db.getEntry(row.id);
  await bot.sendMessage(msg.chat.id, `↩️ <b>복구</b>\n${fmt.escapeHtml(fmt.formatEntryLine(restored))}`, {
    parse_mode: "HTML",
  });
}

async function handleBook(bot, msg, rawArgs) {
  const token = String(rawArgs || "").trim().replace(/^#/, "").toLowerCase();
  const chatId = msg.chat.id;

  if (!token) {
    const current = await resolveBook(chatId, null);
    await bot.sendMessage(
      chatId,
      `이 방의 기본 가계부: <b>${current.toUpperCase()}</b>\n바꾸려면 <code>/book home</code> 또는 <code>/book office</code>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const book = BOOK_TAG.get(token);
  if (!book) {
    await bot.sendMessage(chatId, "home 또는 office 만 지정할 수 있습니다.");
    return;
  }

  await db.upsertChatSetting(chatId, { chatTitle: msg.chat.title || msg.chat.first_name, activeBook: book });
  await bot.sendMessage(chatId, `이 방의 기본 가계부를 <b>${book.toUpperCase()}</b> 로 바꿨습니다.`, {
    parse_mode: "HTML",
  });
}

async function handleDelete(bot, msg, rawArgs) {
  const id = Number(String(rawArgs || "").trim().replace(/^#/, ""));
  if (!Number.isFinite(id)) {
    await bot.sendMessage(msg.chat.id, "취소할 번호를 적어주세요. 예) <code>/del 142</code>", { parse_mode: "HTML" });
    return;
  }

  const ok = await db.voidEntry(id);
  await bot.sendMessage(msg.chat.id, ok ? `🚫 #${id} 기록을 취소했습니다.` : `#${id} 기록을 찾을 수 없습니다.`);
}

/**
 * 직전 대화 내용을 그대로 장부에 반영한다 (/aiok, /저장).
 * 봇이 정리해준 내용이 맞을 때 한 번에 확정하기 위한 명령.
 */
async function handleAiOk(bot, msg) {
  const chatId = msg.chat.id;

  const history = await db.recentChatHistory(chatId, 4);
  if (!history.length) {
    await bot.sendMessage(chatId, "직전 대화가 없습니다. 먼저 내용을 말씀해주세요.");
    return;
  }

  try {
    await bot.sendChatAction?.(chatId, "typing");
  } catch (_) {
    /* 무시 */
  }

  const conversation = history
    .map((turn) => `${turn.role === "user" ? "사용자" : "봇"}: ${turn.content}`)
    .join("\n");

  let result;
  try {
    result = await extractRecords(cfg, conversation, {
      today: dates.today(),
      defaultBook: await resolveBook(chatId, null),
      defaultCurrency: await resolveDefaultCurrency(chatId),
    });
  } catch (err) {
    log("[aiok] 추출 실패:", err.message);
    await bot.sendMessage(chatId, "직전 대화를 해석하지 못했습니다. 다시 말씀해주세요.");
    return;
  }

  if (!result.records.length) {
    await bot.sendMessage(chatId, `🤖 ${result.reply || "직전 대화에서 기록할 거래를 찾지 못했습니다."}`);
    return;
  }

  const saved = await saveRecords(bot, msg, result.records, "🤖 직전 대화 내용을 기록합니다.");

  // 같은 대화로 /aiok 를 또 눌러도 중복 저장되지 않도록 이력에 표시를 남긴다.
  if (saved.length) {
    await db.appendChatHistory(
      chatId,
      "assistant",
      `[기록 완료: ${saved.map((row) => `#${row.id}`).join(", ")}] 위 거래는 이미 장부에 저장되었습니다.`
    );
  }

  log(`[aiok] ${saved.length}건 기록 (${result.provider})`);
}

async function handleWhoAmI(bot, msg) {
  const lines = [
    "🔑 <b>ID 정보</b>",
    `chat_id: <code>${msg.chat.id}</code>`,
    `user_id: <code>${msg.from?.id}</code>`,
    `chat_type: <code>${msg.chat.type}</code>`,
  ];
  if (msg.chat.title) lines.push(`title: <code>${fmt.escapeHtml(msg.chat.title)}</code>`);
  await bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
}

// ---------------------------------------------------------------- 평문(AI) 처리

function minutesAgo(date) {
  if (!date) return null;
  const ts = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function relativeLabel(date) {
  const mins = minutesAgo(date);
  if (mins === null) return "";
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (mins < 1440) return `${Math.floor(mins / 60)}시간 전`;
  return `${Math.floor(mins / 1440)}일 전`;
}

function describeEntry(row) {
  const money = fmt.formatMoney(Number(row.amount), row.currency);
  const memo = row.memo ? ` "${row.memo}"` : "";
  return `#${row.id} ${row.book} ${fmt.DIRECTION_LABEL[row.direction]} ${money}${memo} (${relativeLabel(row.created_at)})`;
}

function undoKeyboard(rows) {
  return {
    inline_keyboard: rows.slice(0, 3).map((row) => [
      { text: `↩️ #${row.id} 복구`, callback_data: `un:${row.id}` },
    ]),
  };
}

/**
 * 한 메시지에서 나온 거래를 순서대로 저장한다.
 * 텔레그램 메시지 번호는 중복 방지 유니크 키라, 두 번째부터는 비워 둔다.
 */
async function saveRecords(bot, msg, records, prefix = "") {
  const saved = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    const row = await saveAndReply(bot, msg, {
      ...record,
      prefix: i === 0 ? prefix : "",
      skipMessageId: i > 0,
    });
    if (row) saved.push(row);
  }

  if (saved.length > 1) {
    const total = saved.reduce(
      (acc, row) => acc + (row.direction === "income" ? 1 : -1) * Number(row.amount_usd),
      0
    );
    await bot.sendMessage(
      msg.chat.id,
      `📌 <b>${saved.length}건 기록 완료</b> · 합계 ${total < 0 ? "−" : "+"}${fmt.formatUsd(Math.abs(total))}`,
      { parse_mode: "HTML" }
    );
  }
  return saved;
}

/** 일반 대화 모델에게 넘길 가계부 현황 요약. 없는 숫자를 지어내지 않게 사실만 준다. */
async function buildLedgerContext() {
  const period = dates.currentMonthRange();
  const rows = await db.sumByBook(period);

  const buckets = { home: { income: 0, expense: 0, transfer: 0 }, office: { income: 0, expense: 0, transfer: 0 } };
  for (const row of rows) {
    if (!buckets[row.book]) continue;
    buckets[row.book][row.direction] = Number(row.total_usd) || 0;
  }

  const lines = [`${period.label} (USD 환산 기준)`];
  for (const book of BOOKS) {
    const b = buckets[book];
    const net = netOf(b);
    lines.push(
      `- ${book}: 수입 ${fmt.formatUsd(b.income)} / 지출 ${fmt.formatUsd(b.expense)} / 송금 ${fmt.formatUsd(b.transfer)} / 잔액 ${net < 0 ? "-" : ""}${fmt.formatUsd(Math.abs(net))}`
    );
  }

  const recent = await db.recentActiveEntries(5);
  if (recent.length) {
    lines.push("최근 기록:");
    for (const row of recent) lines.push(`- ${fmt.formatEntryLine(row)}`);
  }

  return lines.join("\n");
}

async function handleChat(bot, msg, text) {
  const chatId = msg.chat.id;

  if (!cfg.ai.chatEnabled) {
    await bot.sendMessage(chatId, "무슨 뜻인지 모르겠습니다. /help 로 사용법을 볼 수 있습니다.");
    return;
  }

  try {
    await bot.sendChatAction?.(chatId, "typing");
  } catch (_) {
    /* 무시 */
  }

  // 이력은 이번 발화를 넣기 전에 읽는다.
  const [history, ledgerSummary] = await Promise.all([
    db.recentChatHistory(chatId, cfg.ai.historyTurns),
    buildLedgerContext(),
  ]);

  let result;
  try {
    result = await chat(cfg, text, { history, ctx: { today: dates.today(), ledgerSummary } });
  } catch (err) {
    log("[chat] 실패:", err.message);
    await bot.sendMessage(chatId, "지금은 답하기 어렵네요. 잠시 후 다시 말씀해주세요.");
    return;
  }

  await db.appendChatHistory(chatId, "user", text);
  await db.appendChatHistory(chatId, "assistant", result.text);
  await db.pruneChatHistory(chatId, cfg.ai.historyTurns * 4);

  // 평문으로 보낸다 — 모델이 마크다운이나 < > 를 뱉어도 파서가 깨지지 않도록.
  for (const chunk of splitForTelegram(result.text)) {
    await bot.sendMessage(chatId, chunk);
  }

  log(`[chat] ${result.provider} ${result.text.length}자 (이력 ${history.length}턴)`);
}

/** AI 가 고른 동작을 실제로 수행한다. */
async function executeAction(bot, msg, action) {
  const chatId = msg.chat.id;
  const aiNote = action.reply ? `🤖 ${fmt.escapeHtml(action.reply)}` : "";

  switch (action.action) {
    case "record": {
      if (!action.records?.length) {
        await bot.sendMessage(
          chatId,
          `${aiNote || "🤖 금액을 알아듣지 못했습니다."}\n\n금액과 함께 다시 말씀해주세요. 예) <i>어제 시장에서 5만리엘 썼어</i>`,
          { parse_mode: "HTML" }
        );
        return;
      }
      await saveRecords(bot, msg, action.records, aiNote);
      return;
    }

    case "delete_last": {
      const count = action.count || 1;
      const targets = await db.recentActiveEntries(count);
      if (!targets.length) {
        await bot.sendMessage(chatId, "취소할 기록이 없습니다.");
        return;
      }

      for (const row of targets) await db.voidEntry(row.id);

      // 오래된 기록을 '방금 것'으로 지우는 사고를 막기 위해 경과 시간을 알려준다.
      const oldest = Math.max(...targets.map((row) => minutesAgo(row.created_at) ?? 0));
      const stale = oldest > cfg.ai.recentMinutes
        ? `\n\n⚠️ 가장 오래된 것이 ${relativeLabel(targets[targets.length - 1].created_at)} 기록입니다. 의도한 게 아니면 복구하세요.`
        : "";

      const list = targets.map((row) => fmt.escapeHtml(describeEntry(row))).join("\n");
      await bot.sendMessage(
        chatId,
        `${aiNote ? `${aiNote}\n\n` : ""}🚫 <b>${targets.length}건 취소</b>\n${list}${stale}`,
        { parse_mode: "HTML", reply_markup: undoKeyboard(targets) }
      );
      log(`[ai] delete_last ${targets.map((r) => r.id).join(",")}`);
      return;
    }

    case "delete_id": {
      if (!action.entryId) {
        await bot.sendMessage(chatId, "취소할 번호를 알아듣지 못했습니다. 예) <i>142번 취소해줘</i>", {
          parse_mode: "HTML",
        });
        return;
      }
      const row = await db.getEntry(action.entryId);
      if (!row) {
        await bot.sendMessage(chatId, `#${action.entryId} 기록을 찾을 수 없습니다.`);
        return;
      }
      await db.voidEntry(action.entryId);
      await bot.sendMessage(
        chatId,
        `${aiNote ? `${aiNote}\n\n` : ""}🚫 <b>취소</b>\n${fmt.escapeHtml(describeEntry(row))}`,
        { parse_mode: "HTML", reply_markup: undoKeyboard([row]) }
      );
      return;
    }

    case "undo_last":
      await handleUndo(bot, msg);
      return;

    case "summary": {
      const args = [action.book, action.period].filter(Boolean).join(" ");
      await handleShowCalc(bot, msg, args);
      return;
    }

    case "balance":
      await handleBalance(bot, msg);
      return;

    case "list":
      await handleList(bot, msg, [action.count, action.book].filter(Boolean).join(" "));
      return;

    case "set_book":
      await handleBook(bot, msg, action.book || "");
      return;

    case "help":
      await bot.sendMessage(chatId, USAGE, { parse_mode: "HTML" });
      return;

    // 가계부 동작이 아니면 일반 대화로 받아준다.
    case "chat":
    default:
      await handleChat(bot, msg, msg.text || msg.caption || "");
  }
}

async function handleNaturalLanguage(bot, msg, text) {
  const chatId = msg.chat.id;

  // 타이핑 표시는 있으면 좋고 없어도 그만이다 (테스트 스텁에는 없음).
  try {
    await bot.sendChatAction?.(chatId, "typing");
  } catch (_) {
    /* 무시 */
  }

  const recent = await db.recentActiveEntries(cfg.ai.recentEntryCount);
  const ctx = {
    today: dates.today(),
    defaultBook: await resolveBook(chatId, null),
    defaultCurrency: await resolveDefaultCurrency(chatId),
    recentEntries: recent.map(describeEntry).join("\n"),
  };

  let action;
  try {
    action = await interpret(cfg, text, ctx);
  } catch (err) {
    log("[ai] 해석 실패:", err.message);
    await bot.sendMessage(
      chatId,
      "AI 해석에 실패했습니다. 명령어로 입력해주세요.\n<code>/help</code>",
      { parse_mode: "HTML" }
    );
    return;
  }

  log(`[ai] "${text.slice(0, 40)}" -> ${action.action} (${action.provider})`);
  await executeAction(bot, msg, action);
}

// ---------------------------------------------------------------- 라우팅

function parseCommand(text) {
  const match = /^\/([A-Za-z가-힣_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]+))?$/.exec(String(text || "").trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), mention: match[2] || null, args: match[3] || "" };
}

async function dispatch(bot, msg, me) {
  const text = msg.text || msg.caption;
  if (!text || !String(text).trim()) return;

  const command = parseCommand(text);
  if (!command) {
    // 명령어가 아닌 평문은 AI 가 해석한다.
    // 그룹에서는 하지 않는다 — 두 사람의 일상 대화가 전부 AI 로 흘러가면 안 된다.
    if (msg.chat.type !== "private") return;
    if (!isAllowedChat(msg.chat.id)) return;
    if (isBootstrapping() || !isOwner(msg.from?.id)) return;
    if (!cfg.ai.enabled) return;
    await handleNaturalLanguage(bot, msg, String(text).trim());
    return;
  }

  // 그룹에는 번역봇용 명령(/언어 등)도 같이 흘러든다. 모르는 명령은 조용히 무시한다.
  if (command.mention && command.mention.toLowerCase() !== me.username.toLowerCase()) return;

  const known =
    DIRECTION_BY_COMMAND.has(command.name) ||
    [
      "start", "help", "showcalc", "sum", "calc", "bal", "잔액",
      "list", "목록", "book", "del", "undo", "복구", "reset", "초기화",
      "aiok", "저장", "ok", "whoami",
    ].includes(command.name);
  if (!known) return;

  log(
    `[cmd] /${command.name} chat=${msg.chat.id} (${msg.chat.type}${msg.chat.title ? `: ${msg.chat.title}` : ""}) user=${msg.from?.id} (${msg.from?.first_name || ""})`
  );

  if (!isAllowedChat(msg.chat.id)) {
    log(`[deny] chat=${msg.chat.id} cmd=${command.name}`);
    return;
  }

  if (command.name === "whoami" || (isBootstrapping() && command.name === "start")) {
    await handleWhoAmI(bot, msg);
    if (isBootstrapping()) {
      await bot.sendMessage(
        msg.chat.id,
        "아직 소유자가 설정되지 않았습니다. 위 <code>user_id</code> 를 config.json 의 <code>ownerUserIds</code> 에 넣고 봇을 재시작하세요.",
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  if (isBootstrapping() || !isOwner(msg.from?.id)) {
    log(`[deny] user=${msg.from?.id} cmd=${command.name}`);
    return;
  }

  if (DIRECTION_BY_COMMAND.has(command.name)) {
    await handleRecord(bot, msg, DIRECTION_BY_COMMAND.get(command.name), command.args);
    return;
  }

  switch (command.name) {
    case "start":
    case "help":
      await bot.sendMessage(msg.chat.id, USAGE, { parse_mode: "HTML" });
      break;
    case "showcalc":
    case "sum":
    case "calc":
      await handleShowCalc(bot, msg, command.args);
      break;
    case "bal":
    case "잔액":
      await handleBalance(bot, msg);
      break;
    case "list":
    case "목록":
      await handleList(bot, msg, command.args);
      break;
    case "book":
      await handleBook(bot, msg, command.args);
      break;
    case "del":
      await handleDelete(bot, msg, command.args);
      break;
    case "undo":
    case "복구":
      await handleUndo(bot, msg);
      break;
    case "aiok":
    case "저장":
    case "ok":
      await handleAiOk(bot, msg);
      break;
    case "reset":
    case "초기화": {
      const removed = await db.clearChatHistory(msg.chat.id);
      await bot.sendMessage(msg.chat.id, `대화 맥락을 지웠습니다. (${removed}줄)`);
      break;
    }
    default:
      break;
  }
}

async function handleCallback(bot, cb) {
  const data = String(cb.data || "");
  const [action, idRaw, extra] = data.split(":");
  const id = Number(idRaw);

  if (!isOwner(cb.from?.id)) {
    await bot.answerCallbackQuery(cb.id, { text: "권한이 없습니다.", show_alert: true });
    return;
  }
  if (!Number.isFinite(id)) {
    await bot.answerCallbackQuery(cb.id, { text: "잘못된 요청입니다." });
    return;
  }

  // 목록에서의 건별 삭제 — 카드가 아니라 목록을 다시 그려야 한다.
  if (action === "lv") {
    const [, , limitRaw, bookToken] = data.split(":");
    await db.voidEntry(id);
    const view = await buildListView({
      limit: Number(limitRaw) || 10,
      book: bookToken && bookToken !== "-" ? bookToken : null,
    });
    try {
      await bot.editMessageText(view.text, {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        parse_mode: "HTML",
        reply_markup: view.keyboard,
      });
    } catch (err) {
      if (!/message is not modified/i.test(err.message || "")) throw err;
    }
    await bot.answerCallbackQuery(cb.id, { text: `#${id} 삭제했습니다.` });
    log(`[callback] lv:${id} by ${cb.from?.id}`);
    return;
  }

  let notice = "";
  switch (action) {
    case "v":
      await db.voidEntry(id);
      notice = "취소했습니다.";
      break;
    case "ok":
      await db.activateEntry(id);
      notice = "저장했습니다.";
      break;
    case "un":
      await db.restoreEntry(id);
      notice = "복구했습니다.";
      break;
    case "b": {
      if (!BOOKS.includes(extra)) break;
      await db.updateEntryBook(id, extra);
      notice = `${extra.toUpperCase()} 로 옮겼습니다.`;
      break;
    }
    case "okb": {
      // 자동 추출된 pending 을 book 을 정해서 확정한다.
      if (!BOOKS.includes(extra)) break;
      await db.updateEntryBook(id, extra);
      await db.activateEntry(id);
      notice = `${extra.toUpperCase()} 에 저장했습니다.`;
      break;
    }
    case "c": {
      if (!CURRENCIES.includes(extra)) break;
      const row = await db.getEntry(id);
      if (!row) break;
      const { ratePerUsd, amountUsd } = toUsd(Number(row.amount), extra, cfg.fx);
      await db.updateEntryCurrency(id, extra, ratePerUsd, amountUsd);
      notice = `${extra} 로 정정했습니다.`;
      break;
    }
    default:
      break;
  }

  const row = await db.getEntry(id);
  if (row) {
    const text = await buildEntryText(row, { currencyGuessed: false });
    const markup = row.status === "void" ? { inline_keyboard: [] } : buildEntryKeyboard(row, { currencyGuessed: false });
    try {
      await bot.editMessageText(text, {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        parse_mode: "HTML",
        reply_markup: markup,
      });
    } catch (err) {
      // 같은 내용으로 편집하면 텔레그램이 400 을 준다. 무시해도 되는 오류.
      if (!/message is not modified/i.test(err.message || "")) throw err;
    }
  }

  await bot.answerCallbackQuery(cb.id, { text: notice || "처리했습니다." });
  log(`[callback] ${data} by ${cb.from?.id}`);
}

// ---------------------------------------------------------------- 부팅

async function main() {
  db.initPool(cfg.db);
  await db.query("SELECT 1");
  log(`[boot] DB 연결 OK (${cfg.db.host}:${cfg.db.port}/${cfg.db.database})`);

  const bot = new TelegramBot(cfg.telegramBotToken, { polling: true });
  const me = await bot.getMe();
  log(`[boot] @${me.username} polling 시작`);
  log(
    `[boot] owners=${cfg.ownerUserIds.join(",") || "(미설정)"} allowedChats=${cfg.allowedChatIds.join(",") || "ALL"} defaultBook=${cfg.defaultBook} defaultCurrency=${cfg.defaultCurrency}`
  );
  log(
    `[boot] AI 평문해석=${cfg.ai.enabled ? `ON (${cfg.ai.model}${cfg.ai.openaiApiKey ? ` → ${cfg.ai.fallbackModel}` : ""})` : "OFF"}`
  );
  if (isBootstrapping()) {
    log("[boot] ⚠️ ownerUserIds 가 비어 있습니다. 봇에게 /start 를 보내 user_id 를 확인하세요.");
  }

  bot.on("message", async (msg) => {
    try {
      await dispatch(bot, msg, me);
    } catch (err) {
      log("[error] message:", err.stack || err.message);
      try {
        await bot.sendMessage(msg.chat.id, `처리 중 오류가 났습니다: ${err.message}`);
      } catch (_) {
        /* 응답 실패는 무시 */
      }
    }
  });

  bot.on("callback_query", async (cb) => {
    try {
      await handleCallback(bot, cb);
    } catch (err) {
      log("[error] callback:", err.stack || err.message);
      try {
        await bot.answerCallbackQuery(cb.id, { text: `오류: ${err.message}`, show_alert: true });
      } catch (_) {
        /* 응답 실패는 무시 */
      }
    }
  });

  bot.on("polling_error", (err) => log("[polling_error]", err.code || "", err.message));

  if (cfg.autoExtract.enabled) {
    startWatcher({
      cfg,
      log,
      notify: (text, keyboard) =>
        bot.sendMessage(cfg.autoExtract.notifyChatId, text, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        }),
    });
  } else {
    log("[boot] 자동 추출 OFF");
  }
}

// 테스트에서 dispatch/handleCallback 을 직접 부를 수 있도록, 직접 실행일 때만 봇을 띄운다.
if (require.main === module) {
  main().catch((err) => {
    console.error("기동 실패:", err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  dispatch,
  handleCallback,
  executeAction,
  buildListView,
  cfg,
  buildEntryKeyboard,
  buildEntryText,
};
