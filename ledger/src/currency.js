// 금액/통화 파서.
// 캄보디아 환경 특성상 USD 와 KHR(리엘)이 섞이고, 한국 송금은 KRW 로 들어온다.
// 상대방이 크메르 숫자(០-៩)로 쓰는 경우가 있어 파싱 전에 아라비아 숫자로 정규화한다.

const KHMER_DIGITS = "០១២៣៤៥៦៧៨៩";

// 숫자에 바로 붙는 배수 단위. '억'까지만 받는다.
const SCALES = [
  ["억", 100000000],
  ["만", 10000],
  ["천", 1000],
  ["k", 1000],
  ["m", 1000000],
];

// 숫자에 공백 없이 붙을 수 있는 통화 표기. 긴 것부터 검사해야 '원'/'won' 이 안 겹친다.
const ATTACHED_CURRENCY = [
  ["ដុល្លារ", "USD"],
  ["dollars", "USD"],
  ["dollar", "USD"],
  ["달러", "USD"],
  ["usd", "USD"],
  ["불", "USD"],
  ["$", "USD"],
  ["រៀល", "KHR"],
  ["riels", "KHR"],
  ["riel", "KHR"],
  ["리엘", "KHR"],
  ["khr", "KHR"],
  ["៛", "KHR"],
  ["r", "KHR"],
  ["krw", "KRW"],
  ["won", "KRW"],
  ["원", "KRW"],
  ["₩", "KRW"],
].sort((a, b) => b[0].length - a[0].length);

// 공백을 두고 별도 토큰으로 올 수 있는 통화어. 한 글자 'r' 은 메모 첫 글자와 헷갈리므로 제외한다.
const WORD_CURRENCY = new Map([
  ["usd", "USD"], ["dollar", "USD"], ["dollars", "USD"], ["달러", "USD"], ["불", "USD"], ["ដុល្លារ", "USD"],
  ["khr", "KHR"], ["riel", "KHR"], ["riels", "KHR"], ["리엘", "KHR"], ["រៀល", "KHR"],
  ["krw", "KRW"], ["won", "KRW"], ["원", "KRW"],
]);

const PREFIX_SYMBOL = new Map([["$", "USD"], ["₩", "KRW"], ["៛", "KHR"]]);

function normalizeDigits(text) {
  return String(text || "").replace(/[០-៩]/g, (ch) => String(KHMER_DIGITS.indexOf(ch)));
}

/**
 * 문자열 앞부분에서 금액 표현을 뜯어낸다.
 * 예) "$120 pc 2대" / "50000r 시장" / "1만원 배달" / "120 usd 점심"
 * @returns {{amount:number, currency:string|null, matched:string, rest:string}|null}
 */
function parseAmountExpr(input) {
  const text = normalizeDigits(input).trim();
  if (!text) return null;

  let cursor = 0;
  let currency = null;

  // 1) 앞에 붙는 통화 기호 ($120, ៛50000)
  const firstChar = text[0];
  if (PREFIX_SYMBOL.has(firstChar)) {
    currency = PREFIX_SYMBOL.get(firstChar);
    cursor = 1;
    while (text[cursor] === " ") cursor += 1;
  }

  // 2) 숫자 본체 (자리수 콤마 허용, 소수점 허용)
  const numMatch = /^(\d[\d,]*(?:\.\d+)?)/.exec(text.slice(cursor));
  if (!numMatch) return null;
  let amount = Number(numMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  cursor += numMatch[1].length;

  // 3) 숫자에 붙은 배수 단위 (1.2k, 5만, 3천)
  const afterNum = text.slice(cursor).toLowerCase();
  for (const [token, factor] of SCALES) {
    if (!afterNum.startsWith(token)) continue;
    // 'k'/'m' 은 메모 단어(예: "120 mango")를 배수로 오인할 수 있으므로 뒤에 글자가 없을 때만 인정한다.
    if (/^[a-z]$/.test(token) && /[\p{L}\p{N}]/u.test(afterNum.slice(token.length, token.length + 1))) continue;
    amount *= factor;
    cursor += token.length;
    break;
  }

  // 4) 숫자(+단위)에 바로 붙은 통화 표기 (1만원, 50000r, 120$)
  if (!currency) {
    const afterScale = text.slice(cursor).toLowerCase();
    for (const [token, cur] of ATTACHED_CURRENCY) {
      if (!afterScale.startsWith(token)) continue;
      // 'r' 같은 한 글자 표기가 메모 단어를 잘라먹지 않도록, 뒤에 글자가 이어지면 무시한다.
      const nextChar = text.slice(cursor + token.length, cursor + token.length + 1);
      if (token.length === 1 && /[\p{L}\p{N}]/u.test(nextChar)) continue;
      currency = cur;
      cursor += token.length;
      break;
    }
  }

  // 5) 공백 뒤 별도 토큰으로 온 통화어 (120 usd, 50000 리엘)
  if (!currency) {
    const spaced = /^\s+([^\s]+)/.exec(text.slice(cursor));
    if (spaced) {
      const cur = WORD_CURRENCY.get(spaced[1].toLowerCase());
      if (cur) {
        currency = cur;
        cursor += spaced[0].length;
      }
    }
  }

  // KHR 은 소수 단위가 없다. USD/KRW 는 소수 둘째 자리까지.
  amount = currency === "KHR" ? Math.round(amount) : Math.round(amount * 100) / 100;

  return {
    amount,
    currency,
    matched: text.slice(0, cursor).trim(),
    rest: text.slice(cursor).trim(),
  };
}

/**
 * 단위 없는 숫자의 통화를 추측한다. 캄보디아에서 큰 금액의 '지출'은 대개 리엘이다.
 * 반면 수입(월급, 대금)과 송금은 금액이 커도 USD 단위이므로 리엘 추정을 적용하면 안 된다.
 * 어디까지나 추측이므로 호출부에서 반드시 사용자 확인을 받아야 한다.
 */
function guessCurrency(amount, defaultCurrency, direction = "expense") {
  if (direction !== "expense") return defaultCurrency;
  if (defaultCurrency === "USD" && amount >= 1000) return "KHR";
  return defaultCurrency;
}

function toUsd(amount, currency, fx) {
  const rate = Number(fx[currency]);
  if (!(rate > 0)) throw new Error(`환율이 없습니다: ${currency}`);
  return { ratePerUsd: rate, amountUsd: Math.round((amount / rate) * 10000) / 10000 };
}

module.exports = {
  normalizeDigits,
  parseAmountExpr,
  guessCurrency,
  toUsd,
  ATTACHED_CURRENCY,
  WORD_CURRENCY,
};
