// 명령 → DB → 버튼 → 콜백 전 구간 통합 테스트.
// 텔레그램 대신 스텁 봇을 물려 dispatch/handleCallback 을 직접 호출한다.
// 넣은 데이터는 끝에서 모두 지운다.
const assert = require("assert");
const { dispatch, handleCallback, cfg } = require("../src/index");
const db = require("../src/db");

const OWNER = cfg.ownerUserIds[0];
const CHAT = 999900001; // 실제 채팅과 겹치지 않는 테스트용 ID
const ME = { username: "hides_autocalc_bot" };

let messageSeq = 5000;
const sent = [];

const bot = {
  async sendMessage(chatId, text, opts = {}) {
    const message = { chat: { id: chatId }, message_id: ++messageSeq, text, reply_markup: opts.reply_markup };
    sent.push(message);
    return message;
  },
  async editMessageText(text, opts = {}) {
    const target = sent.find((m) => m.message_id === opts.message_id);
    if (target) {
      target.text = text;
      target.reply_markup = opts.reply_markup;
    }
    return target;
  },
  async answerCallbackQuery() {
    return true;
  },
};

function userMessage(text) {
  return {
    chat: { id: CHAT, type: "private" },
    from: { id: OWNER, first_name: "Jo" },
    message_id: ++messageSeq,
    text,
  };
}

function last() {
  return sent[sent.length - 1];
}

async function run(text) {
  await dispatch(bot, userMessage(text), ME);
  return last();
}

async function click(message, callbackData) {
  await handleCallback(bot, {
    id: "cb-test",
    data: callbackData,
    from: { id: OWNER },
    message: { chat: { id: CHAT }, message_id: message.message_id },
  });
  return sent.find((m) => m.message_id === message.message_id);
}

/** 응답 메시지에서 "#12" 형태의 기록 번호를 뽑는다. */
function entryIdOf(message) {
  const match = /#(\d+)/.exec(message.text);
  assert.ok(match, `기록 번호를 찾을 수 없습니다: ${message.text}`);
  return Number(match[1]);
}

async function main() {
  db.initPool(cfg.db);
  const created = [];

  try {
    // --- 1. 지출: 리엘 명시 -------------------------------------------------
    let res = await run("/buy 50000r 프사르 장보기");
    const idKhr = entryIdOf(res);
    created.push(idKhr);
    let row = await db.getEntry(idKhr);
    assert.strictEqual(row.currency, "KHR");
    assert.strictEqual(Number(row.amount), 50000);
    assert.strictEqual(Number(row.amount_usd), 12.1951);
    assert.strictEqual(row.book, "home");
    assert.strictEqual(row.memo, "프사르 장보기");
    console.log("  ok  /buy 리엘 명시 → KHR 기록");

    // --- 2. 지출: 통화 미표기 → 추정 + 정정 버튼 ---------------------------
    res = await run("/buy 25000 택시");
    const idGuess = entryIdOf(res);
    created.push(idGuess);
    row = await db.getEntry(idGuess);
    assert.strictEqual(row.currency, "KHR", "1000 이상 지출은 리엘로 추정해야 함");
    assert.ok(/추정/.test(res.text), "추정 경고가 있어야 함");
    const currencyButtons = res.reply_markup.inline_keyboard[0].map((b) => b.callback_data);
    assert.ok(currencyButtons.some((d) => d === `c:${idGuess}:USD`), "USD 정정 버튼이 있어야 함");
    console.log("  ok  /buy 통화 미표기 → 추정 + 정정 버튼 노출");

    // --- 3. 버튼으로 통화 정정 (KHR → USD) ---------------------------------
    await click(res, `c:${idGuess}:USD`);
    row = await db.getEntry(idGuess);
    assert.strictEqual(row.currency, "USD");
    assert.strictEqual(Number(row.amount_usd), 25000, "정정 시 USD 환산액도 다시 계산되어야 함");
    assert.strictEqual(Number(row.rate_per_usd), 1);
    console.log("  ok  버튼 통화 정정 → 환산액 재계산");

    // --- 4. 수입: 큰 금액이어도 USD ----------------------------------------
    res = await run("/add 1500 월급");
    const idIncome = entryIdOf(res);
    created.push(idIncome);
    row = await db.getEntry(idIncome);
    assert.strictEqual(row.currency, "USD", "수입은 리엘로 추정하면 안 됨");
    assert.strictEqual(row.direction, "income");
    console.log("  ok  /add 수입 → USD 유지");

    // --- 5. #office 태그 + 날짜 지정 ----------------------------------------
    res = await run("/buy 80 프린터 토너 #office @08-10");
    const idOffice = entryIdOf(res);
    created.push(idOffice);
    row = await db.getEntry(idOffice);
    assert.strictEqual(row.book, "office");
    assert.strictEqual(row.memo, "프린터 토너", "태그와 날짜는 메모에서 제거되어야 함");
    const occurred = row.occurred_at instanceof Date
      ? `${row.occurred_at.getFullYear()}-08-10`
      : String(row.occurred_at);
    assert.ok(occurred.endsWith("08-10"), `날짜 지정 실패: ${occurred}`);
    console.log("  ok  #office 태그 + @08-10 날짜 지정");

    // --- 6. 버튼으로 book 이동 ----------------------------------------------
    res = await run("/send 200 엄마");
    const idSend = entryIdOf(res);
    created.push(idSend);
    await click(res, `b:${idSend}:office`);
    row = await db.getEntry(idSend);
    assert.strictEqual(row.book, "office");
    assert.strictEqual(row.direction, "transfer");
    console.log("  ok  버튼 book 이동 home → office");

    // --- 7. 버튼으로 취소 ----------------------------------------------------
    await click(res, `v:${idSend}`);
    row = await db.getEntry(idSend);
    assert.strictEqual(row.status, "void");
    console.log("  ok  버튼 취소 → status=void");

    // --- 8. /del 로 취소 -----------------------------------------------------
    await run(`/del ${idKhr}`);
    row = await db.getEntry(idKhr);
    assert.strictEqual(row.status, "void");
    console.log("  ok  /del 취소");

    // --- 9. 조회 명령들 ------------------------------------------------------
    res = await run("/showcalc");
    assert.ok(/가계부/.test(res.text) && /<pre>/.test(res.text), "집계표가 나와야 함");
    assert.ok(/HOME/.test(res.text) && /OFFICE/.test(res.text), "두 book 이 모두 나와야 함");
    console.log("  ok  /showcalc");

    res = await run("/showcalc office");
    assert.ok(/OFFICE/.test(res.text) && !/HOME/.test(res.text), "office 만 나와야 함");
    console.log("  ok  /showcalc office");

    res = await run("/bal");
    assert.ok(/잔액/.test(res.text));
    console.log("  ok  /bal");

    res = await run("/list 5");
    assert.ok(/최근/.test(res.text));
    console.log("  ok  /list");

    // --- 10. 권한/무시 규칙 --------------------------------------------------
    const before = sent.length;
    await dispatch(bot, { ...userMessage("/언어 1"), text: "/언어 1" }, ME);
    assert.strictEqual(sent.length, before, "모르는 명령(번역봇용)은 조용히 무시해야 함");
    console.log("  ok  모르는 명령 무시");

    await dispatch(
      bot,
      { chat: { id: CHAT, type: "private" }, from: { id: 111222333 }, message_id: ++messageSeq, text: "/buy 10 x" },
      ME
    );
    assert.strictEqual(sent.length, before, "소유자가 아니면 무시해야 함");
    console.log("  ok  비소유자 차단");

    // --- 11. 잘못된 입력 -----------------------------------------------------
    res = await run("/buy 커피");
    assert.ok(/금액을 읽지 못했습니다/.test(res.text));
    console.log("  ok  금액 없는 입력 안내");

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
