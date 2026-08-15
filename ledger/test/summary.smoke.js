// /showcalc 렌더링 스모크 테스트.
// 샘플 데이터를 넣어 표를 그려보고, 끝나면 넣은 행을 지운다.
const { loadConfig } = require("../src/config");
const db = require("../src/db");
const dates = require("../src/dates");
const { parseAmountExpr, guessCurrency, toUsd } = require("../src/currency");
const { renderSummary } = require("../src/summary");

const SAMPLES = [
  ["home", "expense", "50000r 프사르 장보기"],
  ["home", "expense", "120 pc 2대"],
  ["home", "expense", "15000원 배달"],
  ["home", "income", "1500 월급"],
  ["home", "transfer", "200 엄마 송금"],
  ["office", "expense", "80 프린터 토너"],
  ["office", "expense", "250000r 사무실 전기세"],
  ["office", "income", "3200 프로젝트 대금"],
];

async function main() {
  const cfg = loadConfig();
  db.initPool(cfg.db);

  const ids = [];
  for (const [book, direction, text] of SAMPLES) {
    const parsed = parseAmountExpr(text);
    const currency = parsed.currency || guessCurrency(parsed.amount, cfg.defaultCurrency, direction);
    const { ratePerUsd, amountUsd } = toUsd(parsed.amount, currency, cfg.fx);
    const id = await db.insertEntry({
      book,
      direction,
      amount: parsed.amount,
      currency,
      ratePerUsd,
      amountUsd,
      memo: parsed.rest || null,
      occurredAt: dates.today(),
      source: "command",
      rawText: `[SMOKE] ${text}`,
      status: "active",
    });
    ids.push(id);
    console.log(`  넣음 #${id} ${book}/${direction} ${parsed.amount} ${currency} -> $${amountUsd}`);
  }

  console.log("\n================ /showcalc (home+office) ================\n");
  console.log(await renderSummary(dates.currentMonthRange(), cfg.fx, null));

  console.log("\n================ /showcalc office ================\n");
  console.log(await renderSummary(dates.currentMonthRange(), cfg.fx, "office"));

  // 정리
  await db.query(`DELETE FROM ledger_entry WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  console.log(`\n샘플 ${ids.length}건 삭제 완료`);

  await db.getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
