// 금액 파서 검증. 실행: npm test
const assert = require("assert");
const { parseAmountExpr, guessCurrency, toUsd } = require("../src/currency");

const cases = [
  // [입력, 기대 금액, 기대 통화, 기대 메모]
  ["120 pc 2대", 120, null, "pc 2대"],
  ["$120 pc 2대", 120, "USD", "pc 2대"],
  ["120$ 점심", 120, "USD", "점심"],
  ["120 usd 점심", 120, "USD", "점심"],
  ["120불 커피", 120, "USD", "커피"],
  ["120달러 커피", 120, "USD", "커피"],
  ["50000r 시장", 50000, "KHR", "시장"],
  ["50000៛ 시장", 50000, "KHR", "시장"],
  ["៛50000 시장", 50000, "KHR", "시장"],
  ["50000 riel 시장", 50000, "KHR", "시장"],
  ["5만리엘 시장", 50000, "KHR", "시장"],
  ["15000원 배달", 15000, "KRW", "배달"],
  ["1.5만원 배달", 15000, "KRW", "배달"],
  ["₩15000 배달", 15000, "KRW", "배달"],
  ["1.2k 택시", 1200, null, "택시"],
  ["1,250.50 hotel", 1250.5, null, "hotel"],
  ["3천 간식", 3000, null, "간식"],
  // 크메르 숫자
  ["៥០០០០ ផ្សារ", 50000, null, "ផ្សារ"],
  ["៛២០០០០ ទឹក", 20000, "KHR", "ទឹក"],
  // 오인식 방지: 메모 첫 글자가 통화/배수 문자와 겹치는 경우
  ["120 mango 2개", 120, null, "mango 2개"],
  ["120 rice", 120, null, "rice"],
  ["120 riel 물", 120, "KHR", "물"],
];

let failed = 0;
for (const [input, amount, currency, memo] of cases) {
  const result = parseAmountExpr(input);
  try {
    assert.ok(result, `파싱 실패: ${input}`);
    assert.strictEqual(result.amount, amount, `금액 불일치: ${input} -> ${result.amount}`);
    assert.strictEqual(result.currency, currency, `통화 불일치: ${input} -> ${result.currency}`);
    assert.strictEqual(result.rest, memo, `메모 불일치: ${input} -> "${result.rest}"`);
    console.log(`  ok  ${input}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${input}\n      ${err.message}`);
  }
}

// 금액이 없으면 null
for (const bad of ["", "   ", "pc 2대", "abc"]) {
  if (parseAmountExpr(bad) !== null) {
    failed += 1;
    console.error(`FAIL  금액 없는 입력인데 파싱됨: "${bad}"`);
  } else {
    console.log(`  ok  (거부) "${bad}"`);
  }
}

// 단위 없는 숫자 추측: 지출은 1000 이상이면 리엘로 본다
assert.strictEqual(guessCurrency(120, "USD", "expense"), "USD");
assert.strictEqual(guessCurrency(50000, "USD", "expense"), "KHR");
assert.strictEqual(guessCurrency(50000, "KRW", "expense"), "KRW");
// 수입/송금은 금액이 커도 USD — 월급 1500 이 리엘로 잡히면 $0.37 이 되어버린다
assert.strictEqual(guessCurrency(1500, "USD", "income"), "USD");
assert.strictEqual(guessCurrency(3200, "USD", "income"), "USD");
assert.strictEqual(guessCurrency(2000, "USD", "transfer"), "USD");
console.log("  ok  guessCurrency");

// USD 환산
const fx = { USD: 1, KHR: 4100, KRW: 1380 };
assert.strictEqual(toUsd(50000, "KHR", fx).amountUsd, 12.1951);
assert.strictEqual(toUsd(120, "USD", fx).amountUsd, 120);
console.log("  ok  toUsd");

if (failed) {
  console.error(`\n${failed}건 실패`);
  process.exit(1);
}
console.log("\n전부 통과");
