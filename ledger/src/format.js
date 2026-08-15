const SYMBOL = { USD: "$", KHR: "៛", KRW: "₩" };
const DECIMALS = { USD: 2, KHR: 0, KRW: 0 };

const BOOK_LABEL = { home: "🏠 HOME", office: "🏢 OFFICE" };
const DIRECTION_LABEL = { income: "수입", expense: "지출", transfer: "송금" };
const DIRECTION_SIGN = { income: "+", expense: "−", transfer: "−" };

function formatMoney(amount, currency) {
  const digits = DECIMALS[currency] ?? 2;
  const value = Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${SYMBOL[currency] || ""}${value}`;
}

function formatUsd(amount) {
  return formatMoney(amount, "USD");
}

/** 원본 통화가 USD 가 아니면 환산액을 괄호로 덧붙인다. */
function formatWithUsd(amount, currency, amountUsd) {
  const base = formatMoney(amount, currency);
  if (currency === "USD") return base;
  return `${base} (≈${formatUsd(amountUsd)})`;
}

function shortDate(value) {
  if (!value) return "";
  const text = value instanceof Date
    ? `${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : String(value).slice(5, 10);
  return text;
}

function formatEntryLine(row) {
  const sign = DIRECTION_SIGN[row.direction];
  const money = formatWithUsd(Number(row.amount), row.currency, Number(row.amount_usd));
  const memo = row.memo ? ` "${row.memo}"` : "";
  const book = row.book === "office" ? "🏢" : "🏠";
  const auto = row.source === "auto" ? " 🤖" : "";
  return `#${row.id} ${shortDate(row.occurred_at)} ${book} ${DIRECTION_LABEL[row.direction]} ${sign}${money}${memo}${auto}`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 고정폭 표를 만든다. Telegram <pre> 안에서만 정렬이 유지된다. */
function padEnd(text, width) {
  const str = String(text);
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function padStart(text, width) {
  const str = String(text);
  return str.length >= width ? str : " ".repeat(width - str.length) + str;
}

// 한글/한자는 고정폭 글꼴에서 두 칸을 차지한다. 표 정렬이 어긋나지 않도록 실제 표시 폭으로 계산한다.
function isWideChar(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff)
  );
}

function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += isWideChar(ch.codePointAt(0)) ? 2 : 1;
  return width;
}

function padDisplayStart(text, width) {
  const gap = width - displayWidth(text);
  return gap > 0 ? " ".repeat(gap) + text : String(text);
}

function padDisplayEnd(text, width) {
  const gap = width - displayWidth(text);
  return gap > 0 ? String(text) + " ".repeat(gap) : String(text);
}

module.exports = {
  displayWidth,
  padDisplayStart,
  padDisplayEnd,
  SYMBOL,
  DECIMALS,
  BOOK_LABEL,
  DIRECTION_LABEL,
  DIRECTION_SIGN,
  formatMoney,
  formatUsd,
  formatWithUsd,
  formatEntryLine,
  shortDate,
  escapeHtml,
  padEnd,
  padStart,
};
