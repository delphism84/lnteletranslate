// 자연어 해석 + 실행 테스트. 실제 Gemini/OpenAI 를 호출한다(네트워크 필요).
// 넣은 데이터는 끝에서 모두 지운다.
const assert = require("assert");
const { executeAction, cfg } = require("../src/index");
const { interpret } = require("../src/ai");
const db = require("../src/db");
const dates = require("../src/dates");

const OWNER = cfg.ownerUserIds[0];
const CHAT = 999900002;

let messageSeq = 8000;
const sent = [];
const bot = {
  async sendMessage(chatId, text, opts = {}) {
    const message = { chat: { id: chatId }, message_id: ++messageSeq, text, reply_markup: opts.reply_markup };
    sent.push(message);
    return message;
  },
  async sendChatAction() {
    return true;
  },
  async editMessageText() {
    return true;
  },
  async answerCallbackQuery() {
    return true;
  },
};

function userMessage(text) {
  return { chat: { id: CHAT, type: "private" }, from: { id: OWNER, first_name: "Jo" }, message_id: ++messageSeq, text };
}

function last() {
  return sent[sent.length - 1];
}

async function ctxFor() {
  const recent = await db.recentActiveEntries(cfg.ai.recentEntryCount);
  return {
    today: dates.today(),
    defaultBook: "home",
    defaultCurrency: cfg.defaultCurrency,
    recentEntries: recent
      .map((r) => `#${r.id} ${r.book} ${r.direction} ${r.amount}${r.currency} "${r.memo || ""}"`)
      .join("\n"),
  };
}

/** 해석만 확인 (DB 변경 없음) */
async function expectAction(text, expected, extraCheck) {
  const action = await interpret(cfg, text, await ctxFor());
  const detail = JSON.stringify({
    action: action.action,
    records: action.records,
    period: action.period,
  });
  try {
    assert.strictEqual(action.action, expected, `기대 ${expected} / 실제 ${action.action}`);
    if (extraCheck) extraCheck(action);
    console.log(`  ok  "${text}"\n      -> ${detail} [${action.provider}]`);
  } catch (err) {
    console.error(`FAIL  "${text}"\n      -> ${detail}\n      ${err.message}`);
    throw err;
  }
  return action;
}

async function main() {
  db.initPool(cfg.db);
  const created = [];

  try {
    console.log("--- 해석 정확도 ---");

    await expectAction("이번달 얼마 썼어?", "summary");
    await expectAction("잔액 알려줘", "balance");
    await expectAction("최근 내역 보여줘", "list");
    await expectAction("오늘 저녁 뭐 먹지", "chat"); // 잡담은 대화로 넘어간다

    await expectAction("어제 시장에서 5만리엘 썼어", "record", (a) => {
      assert.strictEqual(a.records.length, 1);
      const [r] = a.records;
      assert.strictEqual(r.direction, "expense");
      assert.strictEqual(r.amount, 50000);
      assert.strictEqual(r.currency, "KHR");
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      assert.strictEqual(r.occurredAt, dates.toDateString(yesterday), "어제 날짜로 해석해야 함");
    });

    await expectAction("사무실 프린터 토너 80달러 샀어", "record", (a) => {
      const [r] = a.records;
      assert.strictEqual(r.direction, "expense");
      assert.strictEqual(r.amount, 80);
      assert.strictEqual(r.currency, "USD");
      assert.strictEqual(r.book, "office", "사무실 맥락이면 office 로 가야 함");
    });

    await expectAction("월급 1500달러 들어왔어", "record", (a) => {
      const [r] = a.records;
      assert.strictEqual(r.direction, "income");
      assert.strictEqual(r.amount, 1500);
      assert.strictEqual(r.currency, "USD");
    });

    // 실제로 chat 으로 새버렸던 문장 — 한 문장에 거래 2건
    await expectAction("홈 수입에 $250 추가, 후 지출 100$(아버지오토바이)", "record", (a) => {
      assert.strictEqual(a.records.length, 2, `2건이어야 함 (실제 ${a.records.length}건)`);
      const [income, expense] = a.records;
      assert.strictEqual(income.direction, "income");
      assert.strictEqual(income.amount, 250);
      assert.strictEqual(income.book, "home");
      assert.strictEqual(expense.direction, "expense");
      assert.strictEqual(expense.amount, 100);
      assert.strictEqual(expense.book, "home", "뒤 거래도 같은 book 을 이어받아야 함");
      assert.ok(/오토바이/.test(expense.memo || ""), `메모에 오토바이가 있어야 함: ${expense.memo}`);
    });

    console.log("\n--- 실행: 기록 → '지금 입력분 삭제' → 복구 ---");

    // 1) 자연어로 기록
    let action = await interpret(cfg, "택시비 3달러 썼어", await ctxFor());
    assert.strictEqual(action.action, "record");
    await executeAction(bot, userMessage("택시비 3달러 썼어"), action);
    const recordMsg = last();
    const idMatch = /#(\d+)/.exec(recordMsg.text);
    assert.ok(idMatch, `기록 번호를 찾을 수 없음: ${recordMsg.text}`);
    const entryId = Number(idMatch[1]);
    created.push(entryId);
    let row = await db.getEntry(entryId);
    assert.strictEqual(row.status, "active");
    assert.strictEqual(Number(row.amount), 3);
    assert.strictEqual(row.currency, "USD");
    console.log(`  ok  자연어 기록 → #${entryId} $3 active`);

    // 2) "지금 입력분 삭제해줘"
    action = await expectAction("지금 입력분 삭제해줘", "delete_last");
    await executeAction(bot, userMessage("지금 입력분 삭제해줘"), action);
    row = await db.getEntry(entryId);
    assert.strictEqual(row.status, "void", "방금 기록이 취소되어야 함");
    const undoButton = last().reply_markup?.inline_keyboard?.[0]?.[0];
    assert.ok(undoButton && undoButton.callback_data === `un:${entryId}`, "복구 버튼이 있어야 함");
    console.log(`  ok  "지금 입력분 삭제해줘" → #${entryId} void + 복구 버튼`);

    // 3) "방금 지운거 되살려"
    action = await expectAction("방금 지운거 되살려", "undo_last");
    await executeAction(bot, userMessage("방금 지운거 되살려"), action);
    row = await db.getEntry(entryId);
    assert.strictEqual(row.status, "active", "복구되어야 함");
    console.log(`  ok  "방금 지운거 되살려" → #${entryId} active`);

    console.log("\n전부 통과");
  } finally {
    const ids = created.filter(Boolean);
    if (ids.length) {
      await db.query(`DELETE FROM ledger_entry WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      console.log(`정리: 테스트 기록 ${ids.length}건 삭제`);
    }
    await db.query("DELETE FROM ledger_chat_setting WHERE chat_id = ?", [CHAT]);
    await db.getPool().end();
  }
}

main().catch((err) => {
  console.error("\n실패:", err.message);
  process.exit(1);
});
