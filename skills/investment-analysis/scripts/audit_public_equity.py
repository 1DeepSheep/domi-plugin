#!/usr/bin/env python3
"""Deterministic content gates for public-equity research.

The auditor intentionally checks decision-useful research controls rather than
enforcing one universal financial-model schema.  It accepts Markdown, JSON, or
JSONL control artifacts and has no third-party dependencies.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any, Iterable, Optional


PROFILES = ("deep-dive", "earnings-preview", "earnings-review", "abnormal-move")


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    hint: str
    artifact: str = "research"


@dataclass
class Artifact:
    label: str
    path: Optional[Path]
    text: str = ""
    data: Any = None


@dataclass
class AuditContext:
    profile: str
    strict: bool
    as_of: Optional[date]
    artifacts: dict[str, Artifact]
    issues: list[Issue]

    @property
    def research(self) -> str:
        return self.artifacts["research"].text

    @property
    def combined(self) -> str:
        return "\n".join(a.text for a in self.artifacts.values() if a.text)

    def add(self, severity: str, code: str, message: str, hint: str, artifact: str = "research") -> None:
        issue = Issue(severity, code, message, hint, artifact)
        if issue not in self.issues:
            self.issues.append(issue)

    def control(self, code: str, message: str, hint: str, artifact: str = "research") -> None:
        self.add("ERROR" if self.strict else "WARNING", code, message, hint, artifact)


SECTION_RULES: dict[str, list[tuple[str, tuple[str, ...]]]] = {
    "deep-dive": [
        ("投资结论", (r"投资结论|一句话结论|recommendation|investment call",)),
        ("业务模式与驱动树", (r"商业模式|业务模式|driver tree|收入驱动|量价|unit economics|单位经济",)),
        ("市场预期与差异化观点", (r"市场预期|一致预期|市场争论|预期差|variant view|what is priced",)),
        ("预测与财务传导", (r"盈利预测|财务预测|forecast|model bridge|财务传导|模型调整",)),
        ("现金流与资本配置", (r"自由现金流|FCF|FCFE|资本配置|capital allocation|现金流",)),
        ("估值与隐含预期", (r"估值|目标价|每股价值|反向DCF|implied expectations|SOTP",)),
        ("风险与反面证据", (r"反面证据|最强反方|替代解释|bear case|关键风险|contrary evidence",)),
        ("催化剂与证伪", (r"催化剂|证伪|失效条件|falsif|catalyst",)),
    ],
    "earnings-preview": [
        ("财报事件与研究时点", (r"财报日期|业绩发布日期|earnings date|财报前瞻|预览",)),
        ("近期经营状态", (r"近期经营|上季度|last quarter|最新经营|当前基本面",)),
        ("指引、共识与我们预测", (r"公司指引|guidance", r"一致预期|consensus", r"我们的预测|our estimate|本报告预测")),
        ("财报记分卡", (r"记分卡|scorecard|beat.{0,20}miss|超预期.{0,20}低于预期",)),
        ("模型与估值影响", (r"模型调整|model action|估值影响|每股价值影响|target price impact",)),
        ("情景与投资动作", (r"bull|base|bear|牛市|基准|熊市|情景", r"加仓|减仓|观望|交易动作|trade action")),
        ("反面证据与证伪", (r"反面证据|替代解释|证伪|失效条件|falsif",)),
    ],
    "earnings-review": [
        ("实际、共识与原预测", (r"实际值|reported|actual", r"一致预期|consensus", r"原预测|此前预测|our estimate")),
        ("差异桥", (r"差异桥|variance bridge|超预期|低于预期|beat|miss",)),
        ("新指引与管理层信息", (r"新指引|最新指引|outlook|电话会|earnings call|管理层",)),
        ("预测修正", (r"预测修正|上调|下调|revised estimate|old.{0,20}new",)),
        ("论点更新", (r"论点更新|thesis update|投资逻辑变化|判断变化",)),
        ("估值与投资动作", (r"估值|目标价|每股价值", r"加仓|减仓|持有|观望|投资动作")),
        ("反面证据与证伪", (r"反面证据|替代解释|证伪|失效条件|falsif",)),
    ],
    "abnormal-move": [
        ("异动事实", (r"涨跌幅|大跌|大涨|price move|异常波动|成交量",)),
        ("事件时间线", (r"时间线|timeline|盘前|盘中|盘后|公告时间|发生时间",)),
        ("原因与置信度", (r"原因|归因|causal|driver", r"置信度|confidence|高置信|中置信|低置信")),
        ("市场及同业基线", (r"大盘|指数|同业|同行|peer|sector|market move",)),
        ("基本面与模型影响", (r"基本面影响|盈利影响|模型调整|EPS影响|FCF影响|fundamental impact",)),
        ("估值与是否值得投资", (r"估值|每股价值|目标价|是否值得|risk.reward|风险回报",)),
        ("替代解释与后续验证", (r"替代解释|其他可能|反面证据|证伪|后续验证|next check",)),
    ],
}


IDENTITY_PATTERNS = {
    "actual": (r"\bactual\b|实际值|已实现|历史实际|reported",),
    "guidance": (r"\bguidance\b|公司指引|管理层指引|company outlook|未提供.{0,10}指引|不提供.{0,10}指引|no guidance",),
    "consensus": (r"\bconsensus\b|一致预期|市场预期",),
    "our_estimate": (r"our estimate|我们的预测|本报告预测|自有预测|内部预测",),
    "scenario": (r"\bscenario\b|情景假设|牛市情景|熊市情景|bull case|bear case",),
}


def contains(text: str, patterns: Iterable[str]) -> bool:
    return all(re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL) for pattern in patterns)


def contains_any(text: str, patterns: Iterable[str]) -> bool:
    return any(re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL) for pattern in patterns)


def normalize_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", str(value).lower())


def scalar_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return str(value)


def render_data(value: Any, prefix: str = "") -> list[str]:
    lines: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            lines.extend(render_data(child, child_prefix))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            lines.extend(render_data(child, f"{prefix}[{idx}]"))
    else:
        lines.append(f"{prefix}: {scalar_text(value)}")
    return lines


def load_artifact(label: str, raw_path: Optional[str], required: bool, issues: list[Issue]) -> Artifact:
    if not raw_path:
        if required:
            issues.append(Issue("ERROR", "FILE_REQUIRED", f"--{label} is required", f"Pass --{label} <path>.", label))
        return Artifact(label, None)
    path = Path(raw_path).expanduser().resolve()
    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        issues.append(Issue("ERROR", "FILE_UNREADABLE", f"Cannot read {label}: {path} ({exc})", "Verify the path and UTF-8 encoding.", label))
        return Artifact(label, path)

    data: Any = None
    suffix = path.suffix.lower()
    try:
        if suffix == ".jsonl":
            data = [json.loads(line) for line in raw.splitlines() if line.strip()]
        elif suffix == ".json":
            data = json.loads(raw)
        elif raw.lstrip().startswith(("{", "[")):
            data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        issues.append(Issue("ERROR", "STRUCTURED_PARSE", f"Cannot parse {label} as {suffix or 'JSON'}: {exc}", "Fix invalid JSON/JSONL or use a .md file.", label))
    searchable = raw
    if data is not None:
        searchable += "\n" + "\n".join(render_data(data))
    return Artifact(label, path, searchable, data)


def parse_date(value: Any) -> Optional[date]:
    match = re.search(r"(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})", str(value))
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def flatten_items(value: Any) -> list[tuple[str, Any]]:
    items: list[tuple[str, Any]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            items.append((str(key), child))
            items.extend(flatten_items(child))
    elif isinstance(value, list):
        for child in value:
            items.extend(flatten_items(child))
    return items


def records(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        for key in ("evidence", "claims", "records", "items", "sources"):
            child = value.get(key)
            if isinstance(child, list):
                return [item for item in child if isinstance(item, dict)]
        return [value]
    return []


def record_has(record: dict[str, Any], aliases: Iterable[str]) -> bool:
    wanted = tuple(normalize_key(alias) for alias in aliases)
    return any(any(alias in normalize_key(key) for alias in wanted) and value not in (None, "", []) for key, value in flatten_items(record))


def check_profile_sections(ctx: AuditContext) -> None:
    research = ctx.research
    lines = sum(1 for line in research.splitlines() if line.strip())
    minimums = {"deep-dive": 45, "earnings-preview": 30, "earnings-review": 30, "abnormal-move": 24}
    if lines < minimums[ctx.profile]:
        ctx.add("WARNING", "REPORT_THIN", f"Only {lines} non-empty lines for profile {ctx.profile}", "Confirm the report contains evidence and quantified bridges, not only an executive summary.")
    for label, pattern_groups in SECTION_RULES[ctx.profile]:
        # A tuple with multiple regexes means every concept must be present.
        if not contains(research, pattern_groups):
            ctx.add("ERROR", "SECTION_MISSING", f"Missing core section/signals: {label}", f"Add an explicit '{label}' section with decision-relevant evidence.")


def check_as_of(ctx: AuditContext) -> None:
    report_match = re.search(
        r"(?:as[- ]?of|截至|数据截止|研究时点|股价日期)\s*[:：]?\s*(20\d{2}[年./-]\d{1,2}[月./-]\d{1,2})",
        ctx.research,
        flags=re.IGNORECASE,
    )
    report_date = parse_date(report_match.group(1)) if report_match else None
    if ctx.as_of is None and report_date is None:
        ctx.add("ERROR", "ASOF_MISSING", "No explicit as-of date found", "Add '研究时点/As of: YYYY-MM-DD' or pass --as-of.")
    if ctx.as_of and report_date and ctx.as_of != report_date:
        ctx.add("WARNING", "ASOF_MISMATCH", f"CLI as-of {ctx.as_of} differs from report as-of {report_date}", "Use one research cut-off consistently.")
    effective = ctx.as_of or report_date
    if not effective:
        return

    date_keys = ("publishedat", "publicationdate", "sourcedate", "retrievedat", "发布日期", "来源日期", "采集日期")
    for label, artifact in ctx.artifacts.items():
        if artifact.data is None:
            continue
        for key, value in flatten_items(artifact.data):
            if any(alias in normalize_key(key) for alias in date_keys):
                observed = parse_date(value)
                if observed and observed > effective:
                    ctx.add("ERROR", "ASOF_LEAK", f"{label} contains {key}={observed}, after as-of {effective}", "Remove post-cut-off evidence or advance the documented as-of date.", label)


def check_information_identity(ctx: AuditContext) -> None:
    required = {
        "deep-dive": ("actual", "consensus", "our_estimate"),
        "earnings-preview": ("actual", "guidance", "consensus", "our_estimate", "scenario"),
        "earnings-review": ("actual", "guidance", "consensus", "our_estimate"),
        "abnormal-move": ("actual", "consensus", "our_estimate"),
    }[ctx.profile]
    for identity in required:
        if not contains_any(ctx.combined, IDENTITY_PATTERNS[identity]):
            ctx.add("ERROR", "IDENTITY_MISSING", f"Missing explicit information identity: {identity}", "Label facts as Actual, Guidance, Consensus, Our Estimate, Third-party, Proprietary, or Scenario.")
    if not contains_any(ctx.combined, (r"信息身份|information identity|source type|\bactual\b.{0,80}\bconsensus\b",)):
        ctx.control("IDENTITY_CONTROL_MISSING", "No explicit information-identity control/table detected", "Add an identity/status column to quantified evidence and expectations.")


def check_expectations(ctx: AuditContext) -> None:
    text = ctx.artifacts.get("expectations", Artifact("expectations", None)).text + "\n" + ctx.research
    if not contains_any(text, (r"一致预期|consensus",)) or not contains_any(text, (r"我们的预测|our estimate|本报告预测|自有预测",)):
        ctx.add("ERROR", "EXPECTATION_TRIANGLE", "Consensus and Our Estimate are not both explicit", "Show Company Guidance (if available), dated Consensus, Our Estimate, and the delta.")
    if not contains_any(text, (r"(?:一致预期|consensus).{0,120}(?:20\d{2}[年./-]\d{1,2}[月./-]\d{1,2}|截至|as[- ]?of|来源|source)",)):
        ctx.add("ERROR", "CONSENSUS_UNDATED", "Consensus lacks a visible snapshot date/source", "State consensus provider/source and snapshot date; do not use an undated mean.")
    if not contains_any(text, (r"差异|delta|高于.{0,30}预期|低于.{0,30}预期|beat|miss|bps",)):
        ctx.add("ERROR", "EXPECTATION_DELTA", "No explicit delta between market expectations and Our Estimate", "Quantify the difference by metric and period.")
    if not contains_any(text, (r"预期修正|revision|上调家数|下调家数|high.{0,20}low|分布|区间",)):
        ctx.add("WARNING", "CONSENSUS_DISTRIBUTION", "Consensus distribution/revision path is not visible", "Where available, show dispersion and estimate revisions rather than only the mean.")


def check_transmission(ctx: AuditContext) -> None:
    text = ctx.combined
    waivers = {
        "segment": (r"分部桥.{0,40}(?:不适用|单一分部)|single[- ]segment",),
        "fcf": (r"FCF.{0,60}(?:不适用|不作为估值指标)|自由现金流.{0,60}不适用",),
    }
    bridges = {
        "segment_to_group": contains_any(text, (r"分部|segment|业务线",)) and contains_any(text, (r"集团|合并|group|corporate",)) and contains_any(text, (r"桥|bridge|勾稽|汇总|reconciliation",)),
        "ebit_to_eps": contains_any(text, (r"EBIT|经营利润|营业利润|operating income",)) and contains_any(text, (r"EPS|每股收益|稀释股数|diluted shares",)) and contains_any(text, (r"利息|interest|税率|tax|税前利润|pretax",)),
        "cfo_to_fcf": contains_any(text, (r"CFO|OCF|经营现金流|cash from operations",)) and contains_any(text, (r"capex|资本开支|资本性支出",)) and contains_any(text, (r"FCF|自由现金流|FCFE",)),
        "value_to_share": contains_any(text, (r"企业价值|enterprise value|\bEV\b|股权价值|equity value",)) and contains_any(text, (r"净债务|net debt|现金.{0,20}债务|cash.{0,20}debt",)) and contains_any(text, (r"稀释股数|diluted shares|每股价值|per.share",)),
    }
    if not bridges["segment_to_group"] and not contains_any(text, waivers["segment"]):
        severity = "WARNING" if ctx.profile == "abnormal-move" else "ERROR"
        ctx.add(severity, "SEGMENT_GROUP_BRIDGE", "No segment-to-group reconciliation signal", "Bridge segment revenue/profit to consolidated EBIT, or state why the company is single-segment.")
    if not bridges["ebit_to_eps"]:
        ctx.add("ERROR", "EBIT_EPS_BRIDGE", "No EBIT-to-EPS transmission signal", "Show interest/other items, tax, diluted shares, and EPS.")
    if not bridges["cfo_to_fcf"] and not contains_any(text, waivers["fcf"]):
        ctx.add("ERROR", "FCF_BRIDGE", "No CFO-to-FCF/FCFE transmission signal", "Bridge operating cash flow, working capital, cash capex/leases, financing, and FCF/FCFE without double counting.")
    if not bridges["value_to_share"]:
        ctx.add("ERROR", "VALUE_SHARE_BRIDGE", "No enterprise/equity-value-to-per-share transmission signal", "Show EV, net debt/cash and other adjustments, equity value, diluted shares, and per-share value.")


def check_counterevidence_and_falsification(ctx: AuditContext) -> None:
    text = ctx.artifacts.get("thesis", Artifact("thesis", None)).text + "\n" + ctx.research
    if not contains_any(text, (r"反面证据|最强反方|contrary evidence|strongest counter|替代解释|alternative explanation",)):
        ctx.add("ERROR", "COUNTEREVIDENCE_MISSING", "No explicit strongest contrary evidence/alternative explanation", "Steelman the opposing view and explain what evidence would make it right.")
    numeric_threshold = contains_any(
        text,
        (
            r"(?:证伪|失效|falsif|invalidat|阈值|threshold).{0,180}(?:\d+(?:\.\d+)?\s*(?:%|bps|x|倍|美元|元|亿|万)|高于|低于|超过|跌破)",
            r"(?:\d+(?:\.\d+)?\s*(?:%|bps|x|倍|美元|元|亿|万)|高于|低于|超过|跌破).{0,180}(?:证伪|失效|falsif|invalidat|阈值|threshold)",
        ),
    )
    if not numeric_threshold:
        ctx.add("ERROR", "FALSIFIER_THRESHOLD", "Falsification lacks an observable threshold/direction", "Define a public KPI, observation window, numeric threshold or direction, and thesis consequence.")
    if not contains_any(text, (r"模型调整|model action|预测下调|预测上调|估值下调|估值上调",)):
        ctx.add("ERROR", "FALSIFIER_MODEL_ACTION", "Falsifier is not linked to a model action", "Name the revenue/margin/FCF/valuation field to change if the threshold is hit.")
    if not contains_any(text, (r"加仓|减仓|退出|止损|观望|trade action|position action|仓位",)):
        ctx.add("ERROR", "FALSIFIER_TRADE_ACTION", "Falsifier is not linked to an investment action", "State add/hold/reduce/exit behavior and position constraints.")


def check_evidence(ctx: AuditContext) -> None:
    evidence = ctx.artifacts.get("evidence")
    if not evidence or evidence.path is None:
        ctx.control("EVIDENCE_ARTIFACT_MISSING", "No evidence artifact supplied", "Pass --evidence with claim, root-source, source-cluster, identity, period/unit, and MNPI fields.", "evidence")
        return
    ev_records = records(evidence.data)
    if evidence.data is None:
        for label, aliases in (
            ("root source", ("root_source", "root_document", "原始来源", "根来源")),
            ("source cluster", ("source_cluster_id", "同源簇", "cluster_id")),
            ("information identity", ("information_identity", "信息身份", "source_type")),
        ):
            if not contains_any(evidence.text, tuple(re.escape(alias) for alias in aliases)):
                ctx.control("EVIDENCE_FIELD_MISSING", f"Evidence Markdown lacks {label}", f"Add a {label} field/column.", "evidence")
        return
    if not ev_records:
        ctx.add("ERROR", "EVIDENCE_EMPTY", "Structured evidence contains no records", "Add one atomic claim per evidence record.", "evidence")
        return
    field_rules = {
        "root source": ("root_source", "root_document_id", "root_url", "primary_source", "原始来源", "根来源"),
        "source cluster": ("source_cluster_id", "cluster_id", "同源簇"),
        "information identity": ("information_identity", "identity", "source_type", "信息身份"),
        "period/unit": ("period", "data_period", "unit", "期间", "单位"),
    }
    for label, aliases in field_rules.items():
        coverage = sum(record_has(record, aliases) for record in ev_records) / len(ev_records)
        if coverage < 0.7:
            ctx.control("EVIDENCE_COVERAGE", f"Only {coverage:.0%} of evidence records contain {label}", "Reach at least 70% coverage for carrying claims.", "evidence")
    cluster_aliases = field_rules["source cluster"]
    clusters = set()
    for record in ev_records:
        for key, value in flatten_items(record):
            if any(normalize_key(alias) in normalize_key(key) for alias in cluster_aliases) and value not in (None, ""):
                clusters.add(str(value))
    if len(ev_records) >= 3 and len(clusters) < 2:
        ctx.add("WARNING", "SOURCE_INDEPENDENCE", "Evidence records collapse into fewer than two source clusters", "Do not count syndications or a shared dataset as independent corroboration.", "evidence")


def check_mnpi(ctx: AuditContext) -> None:
    text = ctx.combined
    expert_signal = contains_any(text, (r"专家访谈|expert call|channel check|渠道调研|proprietary|独家数据|供应链调研",))
    mnpi_items: list[tuple[str, Any]] = []
    for artifact in ctx.artifacts.values():
        if artifact.data is not None:
            mnpi_items.extend((key, value) for key, value in flatten_items(artifact.data) if "mnpi" in normalize_key(key))
    bad = ("yes", "true", "potential", "pending", "unknown", "unresolved", "notcleared", "是", "待确认", "未知", "可能")
    good = ("no", "false", "public", "cleared", "notmnpi", "nomnpi", "非mnpi", "已清理", "公开")

    def matches_status(value: Any, statuses: tuple[str, ...]) -> bool:
        normalized = normalize_key(value)
        return any(normalized == token or normalized.startswith(f"{token}mnpi") for token in statuses)

    for key, value in mnpi_items:
        if matches_status(value, bad) and not matches_status(value, good):
            ctx.add("ERROR", "MNPI_UNRESOLVED", f"Unresolved/potential MNPI status: {key}={value}", "Quarantine the evidence; do not use it in the model or investment conclusion.", "evidence")
    explicit_clear = any(matches_status(value, good) for _, value in mnpi_items) or contains_any(
        text, (r"MNPI\s*(?:状态)?\s*[:：]\s*(?:已清理|非MNPI|no|false|cleared|public)",)
    )
    if expert_signal and not explicit_clear:
        ctx.add("ERROR", "MNPI_STATUS_MISSING", "Expert/proprietary/channel evidence lacks explicit MNPI clearance", "Record public/MNPI status, reviewer, and quarantine decision before use.")
    elif not explicit_clear:
        ctx.control("MNPI_CONTROL_MISSING", "No explicit MNPI status found", "Record 'MNPI status: public/not applicable' even when only public sources are used.")


def check_unknowns(ctx: AuditContext) -> None:
    text = ctx.combined
    if contains_any(text, (r"(?:未披露|unknown|not disclosed).{0,50}(?:按|设为|等于|=)\s*0",)):
        ctx.add("ERROR", "UNKNOWN_AS_ZERO", "An undisclosed item appears to be treated as zero", "Keep it unknown or use a sourced range/scenario; never silently fill zero.")
    if not contains_any(text, (r"unknown_registry|未知项|未披露项|未披露|not disclosed|unresolved|待核实",)):
        ctx.control("UNKNOWN_CONTROL_MISSING", "No undisclosed/unknown-item control detected", "List carrying unknowns, reasonable ranges, model fields, and evidence needed to resolve them.")
    elif not contains_any(text, (r"未披露.{0,100}(?:区间|假设|情景|不进入|unknown)|unknown.{0,100}(?:range|scenario|assumption|base case)",)):
        ctx.add("WARNING", "UNKNOWN_HANDLING", "Unknown items are mentioned without a visible range/scenario policy", "Explain whether each item stays unknown, enters a scenario, or is excluded from Base Case.")


def numeric(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.fullmatch(r"\s*[$€£¥￥]?\s*([-+]?\d+(?:,\d{3})*(?:\.\d+)?)\s*", str(value))
    return float(match.group(1).replace(",", "")) if match else None


def find_numeric(data: Any, aliases: Iterable[str]) -> Optional[float]:
    wanted = tuple(normalize_key(alias) for alias in aliases)
    for key, value in flatten_items(data):
        leaf_key = re.sub(r"\[\d+\]$", "", key.rsplit(".", 1)[-1])
        key_norm = normalize_key(leaf_key)
        if key_norm in wanted:
            parsed = numeric(value)
            if parsed is not None:
                return parsed
    return None


def check_valuation(ctx: AuditContext) -> None:
    text = ctx.artifacts.get("model", Artifact("model", None)).text + "\n" + ctx.research
    target_present = contains_any(text, (r"目标价|每股价值|fair value per share|target price|price target",))
    signals = {
        "method/assumption": contains_any(text, (r"DCF|SOTP|EV/|P/E|市盈率|估值倍数|discount rate|折现率|终值",)),
        "enterprise/equity value": contains_any(text, (r"企业价值|enterprise value|股权价值|equity value|\bEV\b",)),
        "cash/debt adjustment": contains_any(text, (r"净债务|net debt|现金.{0,30}债务|cash.{0,30}debt",)),
        "diluted shares": contains_any(text, (r"稀释股数|diluted shares|fully diluted",)),
        "per-share result": target_present,
    }
    if target_present:
        missing = [label for label, present in signals.items() if not present]
        if missing:
            ctx.add("ERROR", "VALUATION_NOT_RECOMPUTABLE", f"Target/per-share value lacks fields: {', '.join(missing)}", "Expose method, forecast metric/multiple or DCF inputs, EV/equity value, net debt/cash, diluted shares, and per-share result.")
    else:
        ctx.control("TARGET_VALUE_MISSING", "No target price/fair value per share is visible", "For an investability conclusion, provide a reproducible fair-value range or state why per-share valuation is not possible.")

    model = ctx.artifacts.get("model")
    if not model or model.data is None:
        return
    enterprise = find_numeric(model.data, ("enterprise_value", "enterprisevalue", "企业价值"))
    cash = find_numeric(model.data, ("cash", "现金"))
    debt = find_numeric(model.data, ("debt", "gross_debt", "债务"))
    net_debt = find_numeric(model.data, ("net_debt", "netdebt", "净债务"))
    equity = find_numeric(model.data, ("equity_value", "equityvalue", "股权价值"))
    shares = find_numeric(model.data, ("diluted_shares", "dilutedshares", "稀释股数"))
    per_share = find_numeric(model.data, ("target_price", "fair_value_per_share", "persharevalue", "目标价", "每股价值"))
    minority = find_numeric(model.data, ("minority_interest", "noncontrollinginterest", "少数股东权益")) or 0.0
    preferred = find_numeric(model.data, ("preferred_equity", "preferredstock", "优先股")) or 0.0
    non_operating = find_numeric(model.data, ("non_operating_assets", "investments", "非经营资产")) or 0.0
    if enterprise is not None and equity is not None and (net_debt is not None or (cash is not None and debt is not None)):
        used_net_debt = net_debt if net_debt is not None else (debt or 0.0) - (cash or 0.0)
        expected_equity = enterprise - used_net_debt - minority - preferred + non_operating
        tolerance = max(abs(equity) * 0.015, 0.02)
        if abs(expected_equity - equity) > tolerance:
            ctx.add("ERROR", "EV_EQUITY_MATH", f"EV-to-equity does not recompute: expected {expected_equity:g}, reported {equity:g}", "Check net debt sign, minority/preferred interests, investments, units, and scenario consistency.", "model")
    if equity is not None and shares is not None and per_share is not None:
        if shares <= 0:
            ctx.add("ERROR", "SHARES_INVALID", f"Diluted shares must be positive, got {shares:g}", "Use positive fully diluted shares in the same unit as equity value.", "model")
        else:
            expected_price = equity / shares
            tolerance = max(abs(per_share) * 0.015, 0.02)
            if abs(expected_price - per_share) > tolerance:
                ctx.add("ERROR", "PER_SHARE_MATH", f"Per-share value does not recompute: expected {expected_price:g}, reported {per_share:g}", "Align equity-value and share-count units and use fully diluted shares.", "model")


def check_profile_specific(ctx: AuditContext) -> None:
    text = ctx.research
    if ctx.profile == "earnings-preview":
        if not contains_any(text, (r"(?:超预期|低于预期|beat|miss|阈值|threshold).{0,100}\d+(?:\.\d+)?\s*(?:%|bps|美元|元|亿|百万|mn|bn)",)):
            ctx.add("ERROR", "SCORECARD_THRESHOLD", "Earnings scorecard lacks numeric surprise thresholds", "For each KPI show Our Estimate, Consensus, beat/miss threshold, model action, and trade action.")
    elif ctx.profile == "earnings-review":
        if not contains_any(text, (r"(?:原预测|旧预测|old).{0,100}(?:新预测|修正后|new)|(?:上调|下调).{0,100}\d+(?:\.\d+)?\s*%",)):
            ctx.add("ERROR", "REVISION_BRIDGE", "No old-to-new estimate revision bridge", "Quantify which operating drivers changed each forecast and valuation field.")
    elif ctx.profile == "abnormal-move":
        if not contains_any(text, (r"(?:大跌|大涨|涨跌幅|price move).{0,80}\d+(?:\.\d+)?\s*%",)):
            ctx.add("ERROR", "MOVE_NOT_QUANTIFIED", "Abnormal move lacks a dated percentage move", "State exchange/ticker, session, close/intraday basis, price change, volume, and timestamp.")
        if not contains_any(text, (r"成交量|换手率|volume|turnover",)):
            ctx.add("ERROR", "FLOW_CONTEXT", "No volume/turnover context for the price move", "Compare with 20/60-day volume and distinguish information from flow/technical pressure.")
        if not contains_any(text, (r"锁定期|解禁|增发|二次发行|强平|被动资金|technical|flow|short interest|空头",)):
            ctx.add("WARNING", "TECHNICAL_CAUSES", "No explicit technical/positioning cause was tested", "Check lock-up, offering, index, short interest, borrow, options, and forced-flow explanations.")


def audit(ctx: AuditContext) -> None:
    if not ctx.research:
        return
    check_profile_sections(ctx)
    check_as_of(ctx)
    check_information_identity(ctx)
    check_expectations(ctx)
    check_transmission(ctx)
    check_counterevidence_and_falsification(ctx)
    check_evidence(ctx)
    check_mnpi(ctx)
    check_unknowns(ctx)
    check_valuation(ctx)
    check_profile_specific(ctx)


def result_payload(ctx: AuditContext) -> dict[str, Any]:
    errors = [issue for issue in ctx.issues if issue.severity == "ERROR"]
    warnings = [issue for issue in ctx.issues if issue.severity == "WARNING"]
    return {
        "profile": ctx.profile,
        "as_of": ctx.as_of.isoformat() if ctx.as_of else None,
        "strict": ctx.strict,
        "passed": not errors,
        "summary": {"errors": len(errors), "warnings": len(warnings)},
        "artifacts": {label: str(artifact.path) if artifact.path else None for label, artifact in ctx.artifacts.items()},
        "issues": [asdict(issue) for issue in sorted(ctx.issues, key=lambda item: (item.severity != "ERROR", item.code, item.artifact))],
    }


def print_result(payload: dict[str, Any], output_format: str) -> None:
    if output_format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    status = "PASS" if payload["passed"] else "FAIL"
    summary = payload["summary"]
    print(f"{status} public-equity audit [{payload['profile']}] — {summary['errors']} error(s), {summary['warnings']} warning(s)")
    for item in payload["issues"]:
        print(f"{item['severity']:<7} {item['code']} ({item['artifact']}): {item['message']}")
        print(f"        Fix: {item['hint']}")


def build_context(args: argparse.Namespace) -> AuditContext:
    issues: list[Issue] = []
    artifacts = {
        "research": load_artifact("research", args.research, True, issues),
        "evidence": load_artifact("evidence", args.evidence, False, issues),
        "expectations": load_artifact("expectations", args.expectations, False, issues),
        "thesis": load_artifact("thesis", args.thesis, False, issues),
        "model": load_artifact("model", args.model, False, issues),
    }
    return AuditContext(args.profile, args.strict, parse_date(args.as_of) if args.as_of else None, artifacts, issues)


def self_test() -> int:
    good_report = """# Public Equity Deep Dive
研究时点：2026-08-13；信息身份：Actual / Guidance / Consensus / Our Estimate / Scenario。
## 投资结论
Base Case目标价9元；在现价6元加仓，证伪后减仓。unknown_registry：未披露项保持unknown，不进入Base Case。
## 业务与商业模式、Driver Tree
量×价×留存驱动收入；分部到集团bridge将A/B分部收入及营业利润勾稽至合并EBIT。
## 市场预期与差异化观点
一致预期（来源Vendor X，截至2026-08-12）EPS 0.70元；我们的预测EPS 0.80元，高于预期14%。公司指引为收入增长10%-12%。
共识分布0.65-0.75元，过去30天预期修正上调。
## 盈利预测与财务传导
Actual收入100，Our Estimate收入120，Scenario包括Bull/Base/Bear。EBIT 20减利息2得税前利润18，按税率20%和稀释股数100得到EPS 0.144。
## 财务质量、现金流与资本配置
CFO/OCF 30减资本开支Capex 10得到FCF 20；FCFE再加入净借款，避免重复计算。
## 估值与隐含预期
SOTP估值倍数形成企业价值EV 1,000；现金100、债务200、净债务100，得到股权价值900；稀释股数100，每股价值/目标价9元。
## 风险、反面证据与最强替代解释
最强反方是留存下降；反面证据是同行促销可能使近期份额数据失真。
## 催化剂与证伪
若留存率低于85%两个季度则证伪；模型调整为收入下调10%、估值下调，投资动作是减仓至0%。下一次财报为催化剂。
## 来源
公司公告2026-08-10；根来源与同源簇见evidence。MNPI状态：公开。
""" + "\n".join(f"补充证据行{i}：Actual运营指标与模型字段核对。" for i in range(40))
    evidence = [
        {"claim": "Revenue", "root_source": "filing", "source_cluster_id": "company", "information_identity": "actual", "period": "Q2", "unit": "CNY", "published_at": "2026-08-10", "mnpi_status": "public"},
        {"claim": "Consensus", "root_source": "vendor", "source_cluster_id": "consensus", "information_identity": "consensus", "period": "Q2", "unit": "CNY", "published_at": "2026-08-12", "mnpi_status": "public"},
        {"claim": "Peer price", "root_source": "exchange", "source_cluster_id": "market", "information_identity": "third_party", "period": "spot", "unit": "CNY", "published_at": "2026-08-13", "mnpi_status": "public"},
    ]
    expectations = {"consensus": 0.7, "consensus_source": "Vendor X", "snapshot_date": "2026-08-12", "our_estimate": 0.8, "delta": 0.1, "guidance": "10%-12%"}
    thesis = {"market_view": "retention falls", "variant_view": "stable", "counter_evidence": "promotion", "falsifier": "retention below 85%", "model_action": "revenue -10%", "trade_action": "reduce"}
    model = {"valuation": {"method": "SOTP", "enterprise_value": 1000, "cash": 100, "debt": 200, "net_debt": 100, "equity_value": 900, "diluted_shares": 100, "target_price": 9}}
    with tempfile.TemporaryDirectory(prefix="audit-public-equity-") as tmp:
        root = Path(tmp)
        (root / "research.md").write_text(good_report, encoding="utf-8")
        for name, payload in (("evidence.json", evidence), ("expectations.json", expectations), ("thesis.json", thesis), ("model.json", model)):
            (root / name).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        args = argparse.Namespace(
            research=str(root / "research.md"), evidence=str(root / "evidence.json"), expectations=str(root / "expectations.json"),
            thesis=str(root / "thesis.json"), model=str(root / "model.json"), profile="deep-dive", as_of="2026-08-13", strict=True,
        )
        good = build_context(args)
        audit(good)
        if any(issue.severity == "ERROR" for issue in good.issues):
            print("SELF-TEST FAIL: strong fixture unexpectedly failed", file=sys.stderr)
            print_result(result_payload(good), "text")
            return 1
        (root / "bad.md").write_text("# 公司分析\n今天大跌，值得买。\n", encoding="utf-8")
        args.research = str(root / "bad.md")
        args.evidence = args.expectations = args.thesis = args.model = None
        args.profile = "abnormal-move"
        args.strict = False
        bad = build_context(args)
        audit(bad)
        if sum(issue.severity == "ERROR" for issue in bad.issues) < 8:
            print("SELF-TEST FAIL: weak fixture did not trigger enough gates", file=sys.stderr)
            print_result(result_payload(bad), "text")
            return 1
    print("SELF-TEST PASS: strong fixture passed and weak fixture triggered content gates")
    return 0


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(
        description="Audit decision-useful content controls in a public-equity research report.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    cli.add_argument("--research", help="Research report (.md, .json, or .jsonl).")
    cli.add_argument("--profile", choices=PROFILES, default="deep-dive", help="Research workflow profile.")
    cli.add_argument("--as-of", help="Research cut-off date (YYYY-MM-DD). Overrides only the audit clock, not the report text.")
    cli.add_argument("--evidence", help="Optional evidence ledger (.md, .json, or .jsonl).")
    cli.add_argument("--expectations", help="Optional expectation ledger (.md, .json, or .jsonl).")
    cli.add_argument("--thesis", help="Optional thesis/variant-view ledger (.md, .json, or .jsonl).")
    cli.add_argument("--model", help="Optional model/valuation control artifact (.md, .json, or .jsonl).")
    cli.add_argument("--strict", action="store_true", help="Promote missing optional research controls to errors.")
    cli.add_argument("--fail-on-warning", action="store_true", help="Return exit code 1 when warnings remain.")
    cli.add_argument("--format", choices=("text", "json"), default="text", help="Output format.")
    cli.add_argument("--self-test", action="store_true", help="Run embedded pass/fail fixtures and exit.")
    return cli


def main() -> int:
    args = parser().parse_args()
    if args.self_test:
        return self_test()
    if not args.research:
        parser().error("--research is required unless --self-test is used")
    if args.as_of and parse_date(args.as_of) is None:
        parser().error("--as-of must be a valid YYYY-MM-DD date")
    ctx = build_context(args)
    audit(ctx)
    payload = result_payload(ctx)
    print_result(payload, args.format)
    if not payload["passed"] or (args.fail_on_warning and payload["summary"]["warnings"]):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
