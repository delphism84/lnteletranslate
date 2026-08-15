const mysql = require("mysql2/promise");

let pool = null;

function initPool(dbConfig) {
  pool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 5,
    charset: "utf8mb4_unicode_ci",
    timezone: "+09:00",
    decimalNumbers: true,
  });
  return pool;
}

function getPool() {
  if (!pool) throw new Error("DB 풀이 초기화되지 않았습니다.");
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** @returns {Promise<number>} 생성된 ledger_entry.id */
async function insertEntry(entry) {
  const sql = `
    INSERT INTO ledger_entry
      (book, direction, amount, currency, rate_per_usd, amount_usd,
       category, memo, quantity, occurred_at, source, confidence,
       tg_chat_id, tg_message_id, tg_user_id, tg_user_name, raw_text, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await getPool().execute(sql, [
    entry.book,
    entry.direction,
    entry.amount,
    entry.currency,
    entry.ratePerUsd,
    entry.amountUsd,
    entry.category ?? null,
    entry.memo ?? null,
    entry.quantity ?? null,
    entry.occurredAt,
    entry.source ?? "command",
    entry.confidence ?? null,
    entry.tgChatId ?? null,
    entry.tgMessageId ?? null,
    entry.tgUserId ?? null,
    entry.tgUserName ?? null,
    entry.rawText ?? null,
    entry.status ?? "active",
  ]);
  return result.insertId;
}

async function getEntry(id) {
  const rows = await query("SELECT * FROM ledger_entry WHERE id = ?", [id]);
  return rows[0] || null;
}

async function voidEntry(id) {
  const [result] = await getPool().execute(
    "UPDATE ledger_entry SET status = 'void' WHERE id = ? AND status <> 'void'",
    [id]
  );
  return result.affectedRows > 0;
}

async function activateEntry(id) {
  const [result] = await getPool().execute(
    "UPDATE ledger_entry SET status = 'active' WHERE id = ? AND status = 'pending'",
    [id]
  );
  return result.affectedRows > 0;
}

/** 통화를 바꾸면 USD 환산액도 같이 다시 계산해야 한다. */
async function updateEntryCurrency(id, currency, ratePerUsd, amountUsd) {
  const [result] = await getPool().execute(
    "UPDATE ledger_entry SET currency = ?, rate_per_usd = ?, amount_usd = ? WHERE id = ?",
    [currency, ratePerUsd, amountUsd, id]
  );
  return result.affectedRows > 0;
}

/** 취소된 기록을 되살린다 (undo). */
async function restoreEntry(id) {
  const [result] = await getPool().execute(
    "UPDATE ledger_entry SET status = 'active' WHERE id = ? AND status = 'void'",
    [id]
  );
  return result.affectedRows > 0;
}

/** '방금 입력한 것' 을 찾기 위한 최근 활성 기록. created_at 기준. */
async function recentActiveEntries(limit = 5) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
  return query(
    `SELECT * FROM ledger_entry WHERE status = 'active' ORDER BY created_at DESC, id DESC LIMIT ${safeLimit}`
  );
}

/** 가장 최근에 취소된 기록 (undo 대상). */
async function lastVoidedEntry() {
  const rows = await query(
    "SELECT * FROM ledger_entry WHERE status = 'void' ORDER BY updated_at DESC, id DESC LIMIT 1"
  );
  return rows[0] || null;
}

async function updateEntryBook(id, book) {
  const [result] = await getPool().execute("UPDATE ledger_entry SET book = ? WHERE id = ?", [book, id]);
  return result.affectedRows > 0;
}

async function listEntries({ book, limit = 10 }) {
  const params = [];
  let where = "status = 'active'";
  if (book) {
    where += " AND book = ?";
    params.push(book);
  }
  // LIMIT 은 프리페어드 파라미터로 넘기면 드라이버가 문자열로 바인딩해 문법 오류가 난다.
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  return query(
    `SELECT * FROM ledger_entry WHERE ${where} ORDER BY id DESC LIMIT ${safeLimit}`,
    params
  );
}

/** book 별 수입/지출/송금 합계(USD 기준) */
async function sumByBook({ from, to }) {
  return query(
    `SELECT book, direction,
            SUM(amount_usd) AS total_usd,
            COUNT(*) AS cnt
       FROM ledger_entry
      WHERE status = 'active' AND occurred_at BETWEEN ? AND ?
      GROUP BY book, direction`,
    [from, to]
  );
}

/** book 별 원본 통화 합계 — 환산 전 실제 통화 구성을 보여주기 위함 */
async function sumByCurrency({ from, to }) {
  return query(
    `SELECT book, currency, direction, SUM(amount) AS total
       FROM ledger_entry
      WHERE status = 'active' AND occurred_at BETWEEN ? AND ?
      GROUP BY book, currency, direction`,
    [from, to]
  );
}

async function sumByCategory({ from, to, book }) {
  const params = [from, to];
  let where = "status = 'active' AND direction <> 'income' AND occurred_at BETWEEN ? AND ?";
  if (book) {
    where += " AND book = ?";
    params.push(book);
  }
  return query(
    `SELECT book, COALESCE(category, memo, '(미분류)') AS label, SUM(amount_usd) AS total_usd
       FROM ledger_entry
      WHERE ${where}
      GROUP BY book, label
      ORDER BY total_usd DESC
      LIMIT 8`,
    params
  );
}

// --------------------------------------------------------- 자동 추출 상태 추적

/** 아직 처리하지 않은 대화 메시지 id 만 골라낸다. */
async function filterUnseenSourceIds(sourceIds) {
  if (!sourceIds.length) return [];
  const placeholders = sourceIds.map(() => "?").join(",");
  const rows = await query(
    `SELECT source_id FROM ledger_source_seen WHERE source_id IN (${placeholders})`,
    sourceIds
  );
  const seen = new Set(rows.map((r) => r.source_id));
  return sourceIds.filter((id) => !seen.has(id));
}

async function markSourceSeen(sourceId, sourceTs, entryId = null) {
  await getPool().execute(
    `INSERT INTO ledger_source_seen (source_id, source_ts, entry_id)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE entry_id = COALESCE(VALUES(entry_id), entry_id)`,
    [sourceId, sourceTs, entryId]
  );
}

/** 처리 이력이 무한정 쌓이지 않게 오래된 것부터 정리한다. */
async function pruneSourceSeen(keep = 5000) {
  const rows = await query("SELECT COUNT(*) AS cnt FROM ledger_source_seen");
  const count = Number(rows[0]?.cnt || 0);
  if (count <= keep) return 0;
  const [result] = await getPool().execute(
    `DELETE FROM ledger_source_seen ORDER BY source_ts ASC LIMIT ${Math.max(0, count - keep)}`
  );
  return result.affectedRows;
}

/**
 * 같은 금액·통화가 최근에 이미 기록됐는지 본다.
 * 두 사람이 같은 거래를 각자 언급하면 중복으로 들어오기 때문에 필요하다.
 */
async function findPossibleDuplicate({ amount, currency, withinHours = 24, excludeId = null }) {
  const params = [amount, currency, withinHours];
  let where = "amount = ? AND currency = ? AND status IN ('active','pending') AND created_at >= NOW() - INTERVAL ? HOUR";
  if (excludeId) {
    where += " AND id <> ?";
    params.push(excludeId);
  }
  const rows = await query(`SELECT * FROM ledger_entry WHERE ${where} ORDER BY id DESC LIMIT 1`, params);
  return rows[0] || null;
}

// --------------------------------------------------------- 평문 대화 이력

/** 오래된 것부터 반환한다 (모델에 넘기는 순서). */
async function recentChatHistory(chatId, turns = 10) {
  const limit = Math.min(Math.max(parseInt(turns, 10) || 10, 1), 30) * 2; // user+assistant 쌍
  const rows = await query(
    `SELECT role, content FROM ledger_chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT ${limit}`,
    [chatId]
  );
  return rows.reverse();
}

async function appendChatHistory(chatId, role, content) {
  await getPool().execute(
    "INSERT INTO ledger_chat_history (chat_id, role, content) VALUES (?, ?, ?)",
    [chatId, role, String(content).slice(0, 8000)]
  );
}

async function clearChatHistory(chatId) {
  const [result] = await getPool().execute("DELETE FROM ledger_chat_history WHERE chat_id = ?", [chatId]);
  return result.affectedRows;
}

/** 방마다 최근 N행만 남긴다. */
async function pruneChatHistory(chatId, keep = 60) {
  const rows = await query(
    `SELECT id FROM ledger_chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${Math.max(0, keep - 1)}`,
    [chatId]
  );
  if (!rows.length) return 0;
  const [result] = await getPool().execute(
    "DELETE FROM ledger_chat_history WHERE chat_id = ? AND id < ?",
    [chatId, rows[0].id]
  );
  return result.affectedRows;
}

async function getChatSetting(chatId) {
  const rows = await query("SELECT * FROM ledger_chat_setting WHERE chat_id = ?", [chatId]);
  return rows[0] || null;
}

async function upsertChatSetting(chatId, { chatTitle, activeBook, defaultCurrency }) {
  await getPool().execute(
    `INSERT INTO ledger_chat_setting (chat_id, chat_title, active_book, default_currency)
     VALUES (?, ?, COALESCE(?, 'home'), COALESCE(?, 'USD'))
     ON DUPLICATE KEY UPDATE
       chat_title = COALESCE(VALUES(chat_title), chat_title),
       active_book = COALESCE(?, active_book),
       default_currency = COALESCE(?, default_currency)`,
    [chatId, chatTitle ?? null, activeBook ?? null, defaultCurrency ?? null, activeBook ?? null, defaultCurrency ?? null]
  );
}

module.exports = {
  initPool,
  getPool,
  query,
  insertEntry,
  getEntry,
  voidEntry,
  activateEntry,
  restoreEntry,
  recentActiveEntries,
  lastVoidedEntry,
  updateEntryCurrency,
  updateEntryBook,
  listEntries,
  sumByBook,
  sumByCurrency,
  sumByCategory,
  getChatSetting,
  upsertChatSetting,
  recentChatHistory,
  appendChatHistory,
  clearChatHistory,
  pruneChatHistory,
  filterUnseenSourceIds,
  markSourceSeen,
  pruneSourceSeen,
  findPossibleDuplicate,
};
