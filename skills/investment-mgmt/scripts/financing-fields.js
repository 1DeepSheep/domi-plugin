#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const TRACKED_INVESTORS = new Map([
  ["红杉", ["红杉", "红杉中国", "hongshan", "sequoia china"]],
  ["高瓴", ["高瓴", "高瓴资本", "hillhouse"]],
  ["IDG", ["idg", "idg capital", "idg资本"]],
  ["锦秋", ["锦秋", "锦秋基金"]],
  ["Monolith/励思资本", ["monolith", "励思资本", "lishi capital"]],
  ["五源", ["五源", "五源资本", "5y capital"]],
  ["蓝驰", ["蓝驰", "蓝驰创投", "bluerun ventures"]],
  ["经纬", ["经纬", "经纬中国", "matrix partners china"]]
]);

function normalizeText(value) {
  return String(value || "").normalize("NFKC").trim();
}

function compactInvestorName(value) {
  return normalizeText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[\s·•,，.。()（）\-_/]+/g, "");
}

function canonicalInvestor(value) {
  const compact = compactInvestorName(value);
  if (!compact) return "";
  for (const [canonical, aliases] of TRACKED_INVESTORS) {
    if (aliases.some((alias) => compactInvestorName(alias) === compact)) return canonical;
  }
  return "";
}

function unitMultiplier(unit) {
  const normalized = normalizeText(unit).toLocaleLowerCase("en-US");
  if (["", "元", "dollar", "dollars", "yuan"].includes(normalized)) return 1;
  if (["万", "万元", "万美元", "10k"].includes(normalized)) return 1e4;
  if (["亿", "亿元", "亿美元", "100m"].includes(normalized)) return 1e8;
  throw new Error(`不支持的金额单位：${unit}`);
}

function normalizeMoney(value) {
  if (!value || value.amount === null || value.amount === undefined || value.amount === "") return null;
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) throw new Error("金额必须是具体数字。");
  const currency = normalizeText(value.currency).toUpperCase();
  if (!["USD", "CNY"].includes(currency)) {
    throw new Error(`不支持的币种：${value.currency || "未填写"}`);
  }
  return {
    amount,
    currency,
    unit: normalizeText(value.unit) || "元",
    multiplier: unitMultiplier(value.unit),
    baseAmount: amount * unitMultiplier(value.unit)
  };
}

function formatNumber(value, maximumFractionDigits = 3) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits,
    useGrouping: true
  }).format(value);
}

function formatMoney(value) {
  const money = normalizeMoney(value);
  if (!money) return "—";
  const suffix = money.multiplier === 1e8
    ? money.currency === "USD" ? "亿美元" : "亿元人民币"
    : money.multiplier === 1e4
      ? money.currency === "USD" ? "万美元" : "万元人民币"
      : money.currency === "USD" ? "美元" : "元人民币";
  return `${formatNumber(money.amount)}${suffix}`;
}

function normalizeDateKey(value) {
  const text = normalizeText(value);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  const match = text.match(/(\d{4})\D*(\d{1,2})?/);
  if (!match) return Number.NEGATIVE_INFINITY;
  return Date.UTC(Number(match[1]), Number(match[2] || 1) - 1, 1);
}

function computedPostMoney(round) {
  const explicit = normalizeMoney(round.postMoney);
  if (explicit) return { money: explicit, computed: false };
  const preMoney = normalizeMoney(round.preMoney);
  const totalRaised = normalizeMoney(round.totalRaised);
  if (!preMoney || !totalRaised || round.includesSecondary || round.includesDebt) return null;
  if (preMoney.currency !== totalRaised.currency) return null;
  return {
    money: {
      amount: preMoney.baseAmount + totalRaised.baseAmount,
      baseAmount: preMoney.baseAmount + totalRaised.baseAmount,
      currency: preMoney.currency,
      multiplier: 1,
      unit: "元"
    },
    computed: true
  };
}

function renderPostMoney(round) {
  const result = computedPostMoney(round);
  if (!result) return "—";
  if (!result.computed) return formatMoney(round.postMoney);
  const unitValue = result.money.baseAmount / 1e8;
  const suffix = result.money.currency === "USD" ? "亿美元" : "亿元人民币";
  return `${formatNumber(unitValue)}${suffix}（据披露金额计算）`;
}

function renderInvestments(round) {
  const parts = [];
  if (round.totalRaised) parts.push(`合计融资${formatMoney(round.totalRaised)}`);
  const investments = Array.isArray(round.investments) ? round.investments : [];
  if (investments.length) {
    const detail = investments.map((item) => {
      const investor = normalizeText(item.investor) || "未披露投资方";
      return item.amount === null || item.amount === undefined || item.amount === ""
        ? `${investor}出资额未披露`
        : `${investor}${formatMoney(item)}`;
    }).join("、");
    parts.push(parts.length ? `其中${detail}` : detail);
  }
  return parts.join("，") || "—";
}

function escapeCell(value) {
  return normalizeText(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function trackedInvestors(rounds) {
  const found = new Set();
  for (const round of rounds) {
    for (const item of Array.isArray(round.investments) ? round.investments : []) {
      const canonical = canonicalInvestor(item.investor);
      if (canonical) found.add(canonical);
    }
    for (const investor of Array.isArray(round.shareholders) ? round.shareholders : []) {
      const canonical = canonicalInvestor(investor);
      if (canonical) found.add(canonical);
    }
  }
  return [...TRACKED_INVESTORS.keys()].filter((name) => found.has(name));
}

function latestValuation(rounds, usdCny) {
  const round = rounds.find((item) => item.completed !== false);
  if (!round) return null;
  const post = computedPostMoney(round);
  if (!post) return null;
  if (post.money.currency === "USD") {
    return Math.round((post.money.baseAmount / 1e8) * 1000) / 1000;
  }
  const rate = Number(usdCny?.rate);
  if (
    !Number.isFinite(rate)
    || rate <= 0
    || !normalizeText(usdCny?.asOf)
    || !normalizeText(usdCny?.source)
  ) return null;
  return Math.round(((post.money.baseAmount / 1e8) / rate) * 1000) / 1000;
}

function buildFinancingFields(input = {}) {
  const rounds = (Array.isArray(input.rounds) ? input.rounds : [])
    .map((round) => ({ ...round }))
    .sort((a, b) => normalizeDateKey(b.date) - normalizeDateKey(a.date));
  const rows = rounds.map((round) => [
    escapeCell(round.date || "—"),
    escapeCell(round.round || "—"),
    escapeCell(formatMoney(round.preMoney)),
    escapeCell(renderInvestments(round)),
    escapeCell(renderPostMoney(round))
  ]);
  const lines = [
    "| 融资时间 | 融资轮次 | 投前估值 | 股东出资情况 | 投后估值 |",
    "|---|---|---:|---|---:|",
    ...(rows.length ? rows.map((row) => `| ${row.join(" | ")} |`) : ["| — | — | — | — | — |"])
  ];
  const valuation = latestValuation(rounds, input.usdCny);
  const latestCompletedRound = rounds.find((round) => round.completed !== false);
  const latestPostMoney = latestCompletedRound ? computedPostMoney(latestCompletedRound) : null;
  if (valuation !== null && latestPostMoney?.money.currency === "CNY") {
    lines.push(
      "",
      `最新估值换算：人民币投后估值 ÷ USD/CNY；汇率 ${formatNumber(Number(input.usdCny.rate), 6)}，日期 ${normalizeText(input.usdCny.asOf) || "—"}，来源 ${normalizeText(input.usdCny.source) || "中国人民银行/中国外汇交易中心"}。`
    );
  }
  return {
    financingHistory: lines.join("\n"),
    latestValuationUsd100m: valuation,
    investors: trackedInvestors(rounds),
    investorSyncMode: input.historyComplete === true ? "replace" : "add-only"
  };
}

function readInput(argv = process.argv.slice(2)) {
  const fileIndex = argv.indexOf("--json-file");
  if (fileIndex >= 0) {
    const filename = argv[fileIndex + 1];
    if (!filename) throw new Error("--json-file 缺少路径。");
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  }
  const chunks = [];
  let chunk;
  while ((chunk = fs.readFileSync(0, { encoding: "utf8", flag: "r" }))) {
    chunks.push(chunk);
    break;
  }
  const raw = chunks.join("").trim();
  if (!raw) throw new Error("请通过 stdin 或 --json-file 提供 JSON。");
  return JSON.parse(raw);
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(buildFinancingFields(readInput()), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  TRACKED_INVESTORS,
  buildFinancingFields,
  canonicalInvestor
};
