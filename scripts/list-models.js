const { loadConfig } = require("../src/config");
const { createOpenAIClient } = require("../src/openaiClient");

async function main() {
  const cfg = loadConfig();
  const client = createOpenAIClient(cfg.openaiApiKey);

  const res = await client.models.list();
  const models = Array.isArray(res?.data) ? res.data : [];

  // id만 깔끔하게 출력
  for (const m of models) {
    if (m?.id) console.log(m.id);
  }
}

main().catch((e) => {
  console.error("[list-models] error:", e?.message || e);
  process.exit(1);
});


