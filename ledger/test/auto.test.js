// 자동 추출 + 건별 삭제 목록 테스트. 실제 AI 를 호출한다(네트워크 필요).
// 가짜 covert-chats.json 을 만들어 워처를 한 번 돌린다. 넣은 데이터는 끝에서 지운다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { handleCallback, buildListView, cfg } = require("../src/index");
const { createWatcher } = require("../src/watcher");
const { hasMoneySignal } = require("../src/extract");
const db = require("../src/db");

const OWNER = cfg.ownerUserIds[0];
const CHAT = -1000000000001; // 테스트 전용 가짜 그룹 ID

// 실제 대화에서 뽑은 문장들. 앞 3건만 진짜 거래다.
const SAMPLE_CHATS = [
  { original: "កាលពីយប់អូនទិញនៅម៉ាត់អស់25$", translated: "어젯밤에 제가 마트에서 25달러 썼어요.", real: true },
  { original: "당신에게 오늘 생활비로 250달러 주엇습니다", translated: "ខ្ញុំបានឲ្យអូន 250 ដុល្លារ", real: true },
  { original: "ហើយក៏បានដក50$ទៅទិញថ្ម", translated: "그리고 50달러를 뽑아서 돌을 사러 갔어.", real: true },
  { original: "ប្រហែល400$500$", translated: "400~500달러 정도", real: false },
  { original: "បើបងចង់ធ្វើផ្ញើ50$មក", translated: "하고 싶으면 50달러 보내줘.", real: false },
  { original: "គាត់យកមួយខែ430$", translated: "그 사람이 월 430달러예요.", real: false },
  { original: "លុយបងទៅកូរ៉េមាន250$", translated: "한국에 가져갈 돈 250달러 있어.", real: false },
  { original: "천천히하세요", translated: "សូមធ្វើយឺតៗ", real: false, noMoney: true },
  { original: "가스렌지 사러 갔나요?", translated: "ទៅទិញចង្ក្រានហ្គាសហើយឬនៅ?", real: false, noMoney: true },
];

function writeSourceFile(filePath) {
  const base = Date.now();
  const chats = SAMPLE_CHATS.map((c, i) => ({
    id: `test-${base}-${i}`,
    ts: base - (SAMPLE_CHATS.length - i) * 60000,
    chatId: CHAT,
    original: c.original,
    translated: c.translated,
    sourceScript: /[\u1780-\u17FF]/.test(c.original) ? "khmer" : "hangul",
    targetLanguage: "Korean",
    source: "telegram",
  }));
  // 사진/이모티콘 신호도 섞어 둔다 — 걸러져야 한다.
  chats.push({ id: `test-${base}-sig`, ts: base, chatId: CHAT, original: "picture", translated: "", sourceScript: "signal" });
  fs.writeFileSync(filePath, JSON.stringify({ chats, updatedAt: new Date(base).toISOString() }, null, 2));
  return chats;
}

async function main() {
  db.initPool(cfg.db);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-auto-"));
  const sourceFile = path.join(tmpDir, "covert-chats.json");
  const sourceChats = writeSourceFile(sourceFile);
  const sourceIds = sourceChats.map((c) => c.id);

  const createdIds = [];

  try {
    // --- 1. 정규식 1차 필터 -------------------------------------------------
    const withMoney = SAMPLE_CHATS.filter((c) => hasMoneySignal(`${c.original} ${c.translated}`));
    assert.strictEqual(withMoney.length, 7, `금액 단서 7건이어야 함 (실제 ${withMoney.length})`);
    for (const c of SAMPLE_CHATS.filter((x) => x.noMoney)) {
      assert.ok(!hasMoneySignal(`${c.original} ${c.translated}`), `금액 없는데 통과됨: ${c.translated}`);
    }
    console.log(`  ok  1단계 정규식 — 9건 중 7건만 AI 대상 (금액 없는 2건 무료 제외)`);

    // --- 2. 워처 한 바퀴 -----------------------------------------------------
    const notifications = [];
    const watcher = createWatcher({
      cfg: {
        ...cfg,
        autoExtract: { ...cfg.autoExtract, sourceFile, processBacklogOnStart: true, minConfidence: 0.8 },
      },
      notify: async (text, keyboard) => {
        notifications.push({ text, keyboard });
      },
      log: () => {},
    });

    await watcher.tick();

    const pending = await db.query(
      "SELECT * FROM ledger_entry WHERE source = 'auto' AND status = 'pending' ORDER BY id"
    );
    createdIds.push(...pending.map((r) => r.id));

    assert.ok(pending.length >= 3, `진짜 거래 3건 이상이 pending 이어야 함 (실제 ${pending.length})`);
    assert.ok(pending.length <= 5, `오탐이 너무 많음 (${pending.length}건)`);
    console.log(`  ok  2단계 AI 판정 — ${pending.length}건을 pending 으로 (진짜 거래 3건 기준)`);

    for (const row of pending) {
      console.log(
        `      #${row.id} ${row.direction} ${row.amount}${row.currency} "${row.memo || ""}" conf=${row.confidence}`
      );
    }

    // 마트 25달러는 반드시 잡혀야 한다
    const mart = pending.find((r) => Number(r.amount) === 25 && r.currency === "USD");
    assert.ok(mart, "마트 25달러 지출이 잡혀야 함");
    assert.strictEqual(mart.direction, "expense");
    assert.strictEqual(mart.status, "pending", "자동 저장하면 안 됨");
    console.log("  ok  '마트에서 25달러 썼어요' → expense $25 pending");

    // 시세 이야기는 잡히면 안 된다
    const quote430 = pending.find((r) => Number(r.amount) === 430);
    assert.ok(!quote430, "'월 430달러예요'(시세)가 기록되면 안 됨");
    console.log("  ok  '월 430달러예요'(시세) 제외");

    assert.strictEqual(notifications.length, pending.length, "pending 마다 확인 메시지가 가야 함");
    const keyboard = notifications[0].keyboard.inline_keyboard;
    const flat = keyboard.flat().map((b) => b.callback_data);
    assert.ok(flat.some((d) => /^okb:\d+:home$/.test(d)), "home 저장 버튼 필요");
    assert.ok(flat.some((d) => /^okb:\d+:office$/.test(d)), "office 저장 버튼 필요");
    assert.ok(flat.some((d) => /^v:\d+$/.test(d)), "무시 버튼 필요");
    console.log("  ok  확인 버튼 [home 저장][office 저장][무시]");

    // --- 3. 같은 파일을 다시 읽어도 중복 질문하지 않는다 --------------------
    const before = (await db.query("SELECT COUNT(*) AS c FROM ledger_entry WHERE source='auto'"))[0].c;
    await watcher.tick();
    const after = (await db.query("SELECT COUNT(*) AS c FROM ledger_entry WHERE source='auto'"))[0].c;
    assert.strictEqual(Number(after), Number(before), "이미 처리한 메시지를 다시 묻지 않아야 함");
    console.log("  ok  재처리 방지 (같은 파일 두 번 읽어도 추가 없음)");

    // --- 4. okb 버튼으로 office 에 확정 -------------------------------------
    const target = pending[0];
    const stubBot = {
      async editMessageText() {
        return true;
      },
      async answerCallbackQuery() {
        return true;
      },
      async sendMessage() {
        return { message_id: 1 };
      },
    };
    await handleCallback(stubBot, {
      id: "cb1",
      data: `okb:${target.id}:office`,
      from: { id: OWNER },
      message: { chat: { id: OWNER }, message_id: 1 },
    });
    const saved = await db.getEntry(target.id);
    assert.strictEqual(saved.status, "active", "저장 버튼을 누르면 active 가 되어야 함");
    assert.strictEqual(saved.book, "office");
    console.log(`  ok  [office 저장] → #${target.id} active/office`);

    // --- 5. 목록 + 건별 삭제 -------------------------------------------------
    let view = await buildListView({ limit: 10, book: null });
    assert.ok(/최근/.test(view.text), "목록 헤더 필요");
    const delButtons = view.keyboard.inline_keyboard.flat();
    assert.ok(delButtons.length > 0, "삭제 버튼이 있어야 함");
    assert.ok(/^lv:\d+:10:-$/.test(delButtons[0].callback_data), `삭제 버튼 형식 오류: ${delButtons[0].callback_data}`);
    assert.ok(delButtons.every((b) => b.callback_data.length <= 64), "callback_data 64바이트 제한");
    console.log(`  ok  /list → ${delButtons.length}개 🗑 버튼 (건별 삭제)`);

    const victim = Number(delButtons[0].callback_data.split(":")[1]);
    await handleCallback(stubBot, {
      id: "cb2",
      data: `lv:${victim}:10:-`,
      from: { id: OWNER },
      message: { chat: { id: OWNER }, message_id: 2 },
    });
    const voided = await db.getEntry(victim);
    assert.strictEqual(voided.status, "void");
    console.log(`  ok  🗑 버튼 → #${victim} 삭제`);

    view = await buildListView({ limit: 10, book: null });
    assert.ok(
      !view.keyboard.inline_keyboard.flat().some((b) => b.callback_data === `lv:${victim}:10:-`),
      "삭제된 항목은 목록에서 빠져야 함"
    );
    console.log("  ok  삭제 후 목록 재렌더링에서 제외");

    // --- 6. /undo 로 복구 ----------------------------------------------------
    await db.restoreEntry(victim);
    assert.strictEqual((await db.getEntry(victim)).status, "active");
    console.log("  ok  복구");

    console.log("\n전부 통과");
  } finally {
    if (createdIds.length) {
      await db.query(
        `DELETE FROM ledger_entry WHERE id IN (${createdIds.map(() => "?").join(",")})`,
        createdIds
      );
      console.log(`정리: 기록 ${createdIds.length}건 삭제`);
    }
    if (sourceIds.length) {
      await db.query(
        `DELETE FROM ledger_source_seen WHERE source_id IN (${sourceIds.map(() => "?").join(",")})`,
        sourceIds
      );
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await db.getPool().end();
  }
}

main().catch((err) => {
  console.error("\n실패:", err.message);
  process.exit(1);
});
