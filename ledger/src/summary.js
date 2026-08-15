const db = require("./db");
const { formatUsd, formatMoney, padDisplayStart, padDisplayEnd, escapeHtml } = require("./format");

const BOOKS = ["home", "office"];

/** 잔액 = 수입 − (지출 + 송금) */
function netOf(bucket) {
  return (bucket.income || 0) - (bucket.expense || 0) - (bucket.transfer || 0);
}

function emptyBucket() {
  return { income: 0, expense: 0, transfer: 0, count: 0 };
}

async function collect({ from, to }) {
  const [byBook, byCurrency, byCategory] = await Promise.all([
    db.sumByBook({ from, to }),
    db.sumByCurrency({ from, to }),
    db.sumByCategory({ from, to }),
  ]);

  const books = { home: emptyBucket(), office: emptyBucket() };
  for (const row of byBook) {
    const bucket = books[row.book];
    if (!bucket) continue;
    bucket[row.direction] = Number(row.total_usd) || 0;
    bucket.count += Number(row.cnt) || 0;
  }

  // book -> currency -> 지출+송금 합계 (원본 통화 그대로)
  const currencyMix = { home: {}, office: {} };
  for (const row of byCurrency) {
    if (row.direction === "income") continue;
    const mix = currencyMix[row.book];
    if (!mix) continue;
    mix[row.currency] = (mix[row.currency] || 0) + Number(row.total);
  }

  return { books, currencyMix, byCategory };
}

/**
 * /showcalc 응답 본문. parse_mode: "HTML" 로 보낼 것.
 * @param {{from:string,to:string,label:string}} period
 * @param {string|null} onlyBook - 지정하면 해당 book 만 표시
 */
async function renderSummary(period, fx, onlyBook = null) {
  const { books, currencyMix, byCategory } = await collect(period);
  const shown = onlyBook ? [onlyBook] : BOOKS;

  const LABEL_W = 6;
  const COL_W = 13;

  const header = padDisplayEnd("구분", LABEL_W) +
    shown.map((b) => padDisplayStart(b.toUpperCase(), COL_W)).join("") +
    (shown.length > 1 ? padDisplayStart("합계", COL_W) : "");

  const lines = [header, "─".repeat(LABEL_W + COL_W * (shown.length + (shown.length > 1 ? 1 : 0)))];

  const rows = [
    ["수입", (b) => books[b].income],
    ["지출", (b) => books[b].expense],
    ["송금", (b) => books[b].transfer],
  ];

  for (const [label, pick] of rows) {
    const values = shown.map(pick);
    const cells = values.map((v) => padDisplayStart(formatUsd(v), COL_W)).join("");
    const total = shown.length > 1
      ? padDisplayStart(formatUsd(values.reduce((a, b) => a + b, 0)), COL_W)
      : "";
    lines.push(padDisplayEnd(label, LABEL_W) + cells + total);
  }

  lines.push("─".repeat(LABEL_W + COL_W * (shown.length + (shown.length > 1 ? 1 : 0))));

  const nets = shown.map((b) => netOf(books[b]));
  const netCells = nets
    .map((v) => padDisplayStart((v < 0 ? "−" : "") + formatUsd(Math.abs(v)), COL_W))
    .join("");
  const netTotalValue = nets.reduce((a, b) => a + b, 0);
  const netTotal = shown.length > 1
    ? padDisplayStart((netTotalValue < 0 ? "−" : "") + formatUsd(Math.abs(netTotalValue)), COL_W)
    : "";
  lines.push(padDisplayEnd("잔액", LABEL_W) + netCells + netTotal);

  const parts = [
    `📊 <b>${escapeHtml(period.label)} 가계부</b>`,
    `<pre>${escapeHtml(lines.join("\n"))}</pre>`,
  ];

  // 환산 전 실제 통화 구성 — USD 만 보면 리엘 지출 규모가 안 보인다.
  for (const book of shown) {
    const mix = currencyMix[book];
    const entries = Object.entries(mix).filter(([, v]) => v > 0);
    if (!entries.length) continue;
    const icon = book === "office" ? "🏢" : "🏠";
    const text = entries.map(([cur, val]) => formatMoney(val, cur)).join("  ·  ");
    parts.push(`${icon} <b>${book.toUpperCase()}</b> 지출 통화별: ${escapeHtml(text)}`);
  }

  const categories = byCategory.filter((row) => !onlyBook || row.book === onlyBook).slice(0, 5);
  if (categories.length) {
    const catLines = categories.map((row) => {
      const icon = row.book === "office" ? "🏢" : "🏠";
      return `${icon} ${padDisplayEnd(String(row.label).slice(0, 16), 18)}${padDisplayStart(formatUsd(row.total_usd), 11)}`;
    });
    parts.push(`💸 <b>지출·송금 상위</b>\n<pre>${escapeHtml(catLines.join("\n"))}</pre>`);
  }

  const totalCount = shown.reduce((acc, b) => acc + books[b].count, 0);
  parts.push(
    `<i>${period.from} ~ ${period.to} · ${totalCount}건 · USD 기준 (៛${fx.KHR.toLocaleString()}/$ · ₩${fx.KRW.toLocaleString()}/$)</i>`
  );

  return parts.join("\n\n");
}

module.exports = { renderSummary, collect, netOf };
