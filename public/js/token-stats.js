"use strict";

const DAILY_TOKENS_KEY = "docode_daily_tokens";
const TOTAL_TOKENS_KEY = "docode_total_tokens";
const TOKEN_FIELDS = ["prompt", "completion", "cached", "calls"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tokenRecord(value = {}) {
  return Object.fromEntries(TOKEN_FIELDS.map(key => {
    const n = Number(value[key] || 0);
    return [key, Number.isFinite(n) && n >= 0 ? n : 0];
  }));
}

function readDailyTokens() {
  const empty = { date: todayStr(), ...tokenRecord() };
  try {
    const value = JSON.parse(localStorage.getItem(DAILY_TOKENS_KEY) || "null");
    return value?.date === empty.date ? { date: empty.date, ...tokenRecord(value) } : empty;
  } catch { return empty; }
}

function readTotalTokens() {
  try { return tokenRecord(JSON.parse(localStorage.getItem(TOTAL_TOKENS_KEY) || "null")); }
  catch { return tokenRecord(); }
}

function recordDailyTokens(event) {
  if (!event) return;
  const usage = tokenRecord(event);
  if (!TOKEN_FIELDS.some(key => usage[key] > 0)) return;
  fetch("/api/token-stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(usage),
  }).catch(error => console.warn("[Token统计] 保存到服务端失败:", error));
  try {
    const daily = readDailyTokens();
    const total = readTotalTokens();
    for (const key of TOKEN_FIELDS) {
      daily[key] += usage[key];
      total[key] += usage[key];
    }
    localStorage.setItem(DAILY_TOKENS_KEY, JSON.stringify(daily));
    localStorage.setItem(TOTAL_TOKENS_KEY, JSON.stringify(total));
  } catch (error) {
    console.warn("[Token统计] 保存到本地失败:", error);
  }
}

async function migrateLocalStorageToServer() {
  try {
    const response = await fetch("/api/token-stats");
    if (!response.ok) return;
    const stats = await response.json();
    if ((stats.total?.prompt || 0) > 0 || (stats.total?.completion || 0) > 0) return;
    const daily = readDailyTokens();
    const total = readTotalTokens();
    if (total.prompt + total.completion <= 0) return;
    if (daily.prompt + daily.completion > 0) {
      await fetch("/api/token-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tokenRecord(daily)) });
    }
    const diff = tokenRecord(Object.fromEntries(TOKEN_FIELDS.map(key => [key, Math.max(0, total[key] - daily[key])])));
    if (diff.prompt + diff.completion > 0) {
      await fetch("/api/token-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(diff) });
    }
  } catch (error) {
    console.warn("[Token统计] 旧数据迁移失败:", error);
  }
}

window.recordDailyTokens = recordDailyTokens;
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(migrateLocalStorageToServer, 2000), { once: true });
else setTimeout(migrateLocalStorageToServer, 2000);
