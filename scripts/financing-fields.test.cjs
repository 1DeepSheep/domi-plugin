"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildFinancingFields,
  canonicalInvestor
} = require("../skills/investment-mgmt/scripts/financing-fields.js");

test("financing fields follow IC memo ordering and compute RMB valuation", () => {
  const result = buildFinancingFields({
    historyComplete: true,
    usdCny: {
      rate: 7.2,
      asOf: "2026-07-28",
      source: "中国人民银行/中国外汇交易中心"
    },
    rounds: [
      {
        date: "2025年6月",
        round: "A轮",
        preMoney: { amount: 20, currency: "CNY", unit: "亿" },
        totalRaised: { amount: 2, currency: "CNY", unit: "亿" },
        investments: [
          { investor: "五源资本", amount: 1.5, currency: "CNY", unit: "亿" },
          { investor: "蓝驰创投", amount: 0.5, currency: "CNY", unit: "亿" }
        ]
      },
      {
        date: "2026年3月",
        round: "B轮",
        preMoney: { amount: 35, currency: "CNY", unit: "亿" },
        postMoney: { amount: 36, currency: "CNY", unit: "亿" },
        totalRaised: { amount: 1, currency: "CNY", unit: "亿" },
        investments: [
          { investor: "HongShan", amount: 1, currency: "CNY", unit: "亿" }
        ]
      }
    ]
  });

  assert.ok(result.financingHistory.indexOf("2026年3月") < result.financingHistory.indexOf("2025年6月"));
  assert.match(result.financingHistory, /汇率 7\.2/);
  assert.equal(result.latestValuationUsd100m, 5);
  assert.deepEqual(result.investors, ["红杉", "五源", "蓝驰"]);
  assert.equal(result.investorSyncMode, "replace");
});

test("incomplete history never authorizes investor deletion", () => {
  const result = buildFinancingFields({
    rounds: [{
      date: "2026年1月",
      round: "天使轮",
      postMoney: { amount: 50, currency: "USD", unit: "万" },
      investments: [{ investor: "Monolith", amount: 10, currency: "USD", unit: "万" }]
    }]
  });

  assert.equal(result.latestValuationUsd100m, 0.005);
  assert.deepEqual(result.investors, ["Monolith/励思资本"]);
  assert.equal(result.investorSyncMode, "add-only");
});

test("latest valuation stays empty when the latest completed round is incomplete", () => {
  const result = buildFinancingFields({
    rounds: [
      {
        date: "2026年6月",
        round: "B轮",
        investments: [{ investor: "IDG", amount: 1, currency: "USD", unit: "亿" }]
      },
      {
        date: "2025年6月",
        round: "A轮",
        postMoney: { amount: 2, currency: "USD", unit: "亿" }
      }
    ]
  });
  assert.equal(result.latestValuationUsd100m, null);
});

test("RMB valuation requires a dated and sourced exchange rate", () => {
  const result = buildFinancingFields({
    usdCny: { rate: 7.2 },
    rounds: [{
      date: "2026年6月",
      round: "A轮",
      postMoney: { amount: 7.2, currency: "CNY", unit: "亿" }
    }]
  });
  assert.equal(result.latestValuationUsd100m, null);
  assert.doesNotMatch(result.financingHistory, /最新估值换算/);
});

test("tracked investor aliases normalize to canonical labels", () => {
  assert.equal(canonicalInvestor("Sequoia China"), "红杉");
  assert.equal(canonicalInvestor("IDG Capital"), "IDG");
  assert.equal(canonicalInvestor("Matrix Partners China"), "经纬");
  assert.equal(canonicalInvestor("腾讯"), "");
});
