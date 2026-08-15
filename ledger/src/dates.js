// 컨테이너 TZ 를 Asia/Seoul 로 띄우고 로컬 시간 기준으로 계산한다.

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toDateString(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function today() {
  return toDateString(new Date());
}

function monthRange(year, month) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0); // 다음 달 0일 = 이번 달 말일
  return { from: toDateString(from), to: toDateString(to), label: `${year}년 ${month}월` };
}

function currentMonthRange() {
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth() + 1);
}

function weekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=일
  const diffToMonday = day === 0 ? 6 : day - 1;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  return { from: toDateString(from), to: toDateString(to), label: "이번 주" };
}

/**
 * "today" | "week" | "month" | "2026-08" | "2026-08-15" 를 기간으로 바꾼다.
 * 인식할 수 없으면 null.
 */
function resolvePeriod(input) {
  const token = String(input || "").trim().toLowerCase();
  if (!token || token === "month" || token === "이번달" || token === "이달") return currentMonthRange();
  if (token === "today" || token === "오늘") {
    const d = today();
    return { from: d, to: d, label: "오늘" };
  }
  if (token === "week" || token === "이번주") return weekRange();

  const ym = /^(\d{4})-(\d{1,2})$/.exec(token);
  if (ym) return monthRange(Number(ym[1]), Number(ym[2]));

  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token);
  if (ymd) {
    const d = `${ymd[1]}-${pad2(Number(ymd[2]))}-${pad2(Number(ymd[3]))}`;
    return { from: d, to: d, label: d };
  }

  return null;
}

module.exports = { pad2, toDateString, today, monthRange, currentMonthRange, weekRange, resolvePeriod };
