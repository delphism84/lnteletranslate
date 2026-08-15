// 평문 -> 가계부 동작 / 일반 대화 분기 테스트. 실제 AI 를 호출한다(네트워크 필요).
const assert = require("assert");
const { dispatch, cfg } = require("../src/index");
const { splitForTelegram } = require("../src/chat");
const db = require("../src/db");

const OWNER = cfg.ownerUserIds[0];
const CHAT = 999900003;
const ME = { username: "hides_autocalc_bot" };

let messageSeq = 12000;
const sent = [];

const bot = {
  async sendMessage(chatId, text, opts = {}) {
    const message = { chat: { id: chatId }, message_id: ++messageSeq, text, opts };
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

async function say(text) {
  const before = sent.length;
  await dispatch(bot, userMessage(text), ME);
  return sent.slice(before);
}

async function main() {
  db.initPool(cfg.db);
  const createdIds = [];

  try {
    // --- 1. 길이 분할 (네트워크 불필요) --------------------------------------
    const long = "가".repeat(9000);
    const chunks = splitForTelegram(long);
    assert.ok(chunks.length >= 3, "9000자는 여러 조각으로 나뉘어야 함");
    assert.ok(chunks.every((c) => c.length <= 4000), "각 조각은 4000자 이하");
    console.log(`  ok  긴 답변 분할 — 9000자 → ${chunks.length}조각`);

    // --- 2. 일반 대화로 빠지는지 ---------------------------------------------
    await db.clearChatHistory(CHAT);

    let replies = await say("안녕! 오늘 기분이 별로네");
    assert.strictEqual(replies.length, 1, "답이 하나 와야 함");
    assert.ok(replies[0].text.length > 0, "빈 답변");
    assert.ok(!replies[0].opts.parse_mode, "대화 답변은 평문으로 보내야 파서가 안 깨짐");
    console.log(`  ok  잡담 → 대화 응답: "${replies[0].text.slice(0, 50)}..."`);

    // --- 3. 맥락이 이어지는지 -------------------------------------------------
    await say("내가 좋아하는 과일은 망고야. 기억해줘");
    replies = await say("내가 좋아하는 과일이 뭐라고 했지?");
    assert.ok(/망고/.test(replies[0].text), `맥락을 기억해야 함: "${replies[0].text}"`);
    console.log(`  ok  맥락 유지 — "${replies[0].text.slice(0, 50)}..."`);

    const history = await db.recentChatHistory(CHAT, 10);
    assert.ok(history.length >= 6, `이력이 DB 에 쌓여야 함 (현재 ${history.length})`);
    assert.strictEqual(history[0].role, "user", "이력은 오래된 것부터여야 함");
    console.log(`  ok  이력 DB 저장 — ${history.length}턴`);

    // --- 4. 가계부 동작은 대화로 새지 않아야 한다 -----------------------------
    replies = await say("커피 4달러 썼어");
    const recordText = replies.map((r) => r.text).join("\n");
    assert.ok(/#\d+/.test(recordText), `기록 카드가 나와야 함: "${recordText.slice(0, 80)}"`);
    const idMatch = /#(\d+)/.exec(recordText);
    createdIds.push(Number(idMatch[1]));
    const row = await db.getEntry(Number(idMatch[1]));
    assert.strictEqual(Number(row.amount), 4);
    assert.strictEqual(row.direction, "expense");
    console.log(`  ok  "커피 4달러 썼어" → 대화가 아니라 기록 (#${row.id})`);

    replies = await say("이번달 얼마 썼어?");
    assert.ok(/가계부|집계|잔액/.test(replies[0].text), `집계표가 나와야 함: "${replies[0].text.slice(0, 60)}"`);
    console.log("  ok  \"이번달 얼마 썼어?\" → 집계표 (대화 아님)");

    // --- 5. 돈 얘기지만 조작이 아닌 것은 대화로 -------------------------------
    replies = await say("요즘 돈 관리 잘하려면 어떻게 해야 할까?");
    assert.ok(replies[0].text.length > 10, "상담성 질문은 대화로 답해야 함");
    assert.ok(!/^🧾|^📊/.test(replies[0].text), "집계표가 아니라 대화여야 함");
    console.log(`  ok  상담성 질문 → 대화: "${replies[0].text.slice(0, 50)}..."`);

    // --- 6. /저장 — 직전 대화를 그대로 장부에 반영 ---------------------------
    // 실제로 봇이 기록하지 못하고 대화로 흘려보냈던 상황을 그대로 재현한다.
    await db.clearChatHistory(CHAT);
    await db.appendChatHistory(CHAT, "user", "홈 수입에 $250 추가, 후 지출 100$(아버지오토바이)");
    await db.appendChatHistory(
      CHAT,
      "assistant",
      "네, 그렇게 기록하고 싶으시군요! '홈 수입 250달러'는 수입으로, '홈 지출 100달러 아버지오토바이'는 지출로 기록됩니다."
    );

    replies = await say("/저장");
    const savedText = replies.map((r) => r.text).join("\n");
    const savedIds = [...savedText.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    createdIds.push(...savedIds);

    assert.strictEqual(savedIds.length, 2, `2건이 기록되어야 함 (실제 ${savedIds.length}건)\n${savedText}`);
    const [first, second] = await Promise.all(savedIds.map((id) => db.getEntry(id)));
    const income = [first, second].find((r) => r.direction === "income");
    const expense = [first, second].find((r) => r.direction === "expense");
    assert.ok(income && Number(income.amount) === 250, "수입 $250 이 있어야 함");
    assert.ok(expense && Number(expense.amount) === 100, "지출 $100 이 있어야 함");
    assert.strictEqual(income.book, "home");
    assert.strictEqual(expense.book, "home");
    assert.ok(/오토바이/.test(expense.memo || ""), `메모 확인: ${expense.memo}`);
    console.log(`  ok  /저장 → 2건 기록 (수입 $250 #${income.id} / 지출 $100 "${expense.memo}" #${expense.id})`);

    // 같은 대화로 또 저장해도 중복되지 않아야 한다
    replies = await say("/저장");
    const againIds = [...replies.map((r) => r.text).join("\n").matchAll(/#(\d+)/g)]
      .map((m) => Number(m[1]))
      .filter((id) => !savedIds.includes(id));
    createdIds.push(...againIds);
    assert.strictEqual(againIds.length, 0, `중복 저장되면 안 됨 (${againIds.length}건 추가됨)`);
    console.log("  ok  /저장 두 번 눌러도 중복 저장 없음");

    // --- 7. /reset ------------------------------------------------------------
    replies = await say("/reset");
    assert.ok(/지웠습니다/.test(replies[0].text));
    assert.strictEqual((await db.recentChatHistory(CHAT, 10)).length, 0, "이력이 비워져야 함");
    console.log("  ok  /reset → 대화 맥락 삭제");

    console.log("\n전부 통과");
  } finally {
    if (createdIds.length) {
      await db.query(
        `DELETE FROM ledger_entry WHERE id IN (${createdIds.map(() => "?").join(",")})`,
        createdIds
      );
      console.log(`정리: 기록 ${createdIds.length}건 삭제`);
    }
    await db.clearChatHistory(CHAT);
    await db.query("DELETE FROM ledger_chat_setting WHERE chat_id = ?", [CHAT]);
    await db.getPool().end();
  }
}

main().catch((err) => {
  console.error("\n실패:", err.message);
  process.exit(1);
});
