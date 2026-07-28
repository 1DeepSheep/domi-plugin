#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const FIELD_NAME = "入库时间";
const FIELD_TYPE = "created_at";
const FIELD_DESCRIPTION = "系统自动记录该项目或人脉首次写入当前表的时间；只读，不得手动覆盖。";

function configPath(env = process.env) {
  return String(env.DOMI_CONFIG_PATH || "").trim()
    || path.join(os.homedir(), "Library", "Application Support", "domi", "domi-plugin-config.json");
}

function readConfig(env = process.env) {
  const target = configPath(env);
  if (!fs.existsSync(target)) {
    throw new Error("未找到 domi 本机配置，请先在 domi“设置 → 资料连接”完成配置。");
  }
  const config = JSON.parse(fs.readFileSync(target, "utf8"));
  if (config.storageBackend === "local") {
    return { storageBackend: "local" };
  }
  const required = [
    "projectBaseToken",
    "projectTableId",
    "peopleBaseToken",
    "peopleTableId"
  ];
  if (required.some((key) => !String(config[key] || "").trim())) {
    throw new Error("项目表或人脉表尚未配置，请先在 domi“设置 → 资料连接”补充。");
  }
  return config;
}

function responseItems(response) {
  return response?.data?.items
    || response?.items
    || response?.data?.fields
    || response?.fields
    || [];
}

function fieldName(field) {
  return String(field?.field_name || field?.fieldName || field?.name || "").trim();
}

function fieldType(field) {
  return String(field?.ui_type || field?.type_name || field?.type || "").trim().toLowerCase();
}

function isCreatedAtField(field) {
  return fieldType(field) === FIELD_TYPE || Number(field?.type) === 1001;
}

function defaultRunLark(args, env = process.env) {
  const binary = String(env.LARK_CLI_PATH || "").trim() || "lark-cli";
  try {
    const stdout = execFileSync(binary, args, {
      encoding: "utf8",
      env: {
        ...env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1"
      },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000
    });
    return JSON.parse(stdout.trim());
  } catch {
    throw new Error("飞书入库时间字段操作失败，请检查用户授权、目标表权限和网络连接。");
  }
}

function targets(config) {
  return [
    {
      kind: "project",
      label: "项目表",
      baseToken: config.projectBaseToken,
      tableId: config.projectTableId
    },
    {
      kind: "people",
      label: "人脉表",
      baseToken: config.peopleBaseToken,
      tableId: config.peopleTableId
    }
  ];
}

function listFields(target, runLark) {
  return responseItems(runLark([
    "base",
    "+field-list",
    "--base-token",
    target.baseToken,
    "--table-id",
    target.tableId,
    "--limit",
    "200",
    "--as",
    "user",
    "--format",
    "json"
  ]));
}

function inspectTarget(target, runLark) {
  const matches = listFields(target, runLark).filter((field) => fieldName(field) === FIELD_NAME);
  if (matches.length > 1) {
    throw new Error(`${target.label}存在多个“${FIELD_NAME}”字段，请先人工保留一个。`);
  }
  if (matches.length === 1 && !isCreatedAtField(matches[0])) {
    throw new Error(`${target.label}的“${FIELD_NAME}”不是系统创建时间字段；为避免破坏数据，已停止自动迁移。`);
  }
  return {
    target,
    status: matches.length === 1 ? "present" : "missing"
  };
}

function createField(target, runLark) {
  runLark([
    "base",
    "+field-create",
    "--base-token",
    target.baseToken,
    "--table-id",
    target.tableId,
    "--json",
    JSON.stringify({
      type: FIELD_TYPE,
      name: FIELD_NAME,
      description: FIELD_DESCRIPTION,
      style: { format: "yyyy-MM-dd HH:mm" }
    }),
    "--as",
    "user",
    "--format",
    "json"
  ]);
}

function ensureIntakeTimeFields({
  config,
  ensure = true,
  runLark = (args) => defaultRunLark(args)
}) {
  if (config.storageBackend === "local") {
    return {
      ok: true,
      backend: "local",
      skipped: true,
      reason: "本地资料库已使用 SQLite 系统创建时间。"
    };
  }

  const inspected = targets(config).map((target) => inspectTarget(target, runLark));
  if (!ensure) {
    return {
      ok: inspected.every((item) => item.status === "present"),
      backend: "feishu",
      tables: inspected.map((item) => ({
        kind: item.target.kind,
        field: FIELD_NAME,
        type: FIELD_TYPE,
        status: item.status
      }))
    };
  }

  for (const item of inspected.filter((entry) => entry.status === "missing")) {
    createField(item.target, runLark);
  }

  const verified = targets(config).map((target) => inspectTarget(target, runLark));
  if (verified.some((item) => item.status !== "present")) {
    throw new Error("“入库时间”字段创建后回读验证失败。");
  }
  const createdKinds = new Set(
    inspected.filter((item) => item.status === "missing").map((item) => item.target.kind)
  );
  return {
    ok: true,
    backend: "feishu",
    tables: verified.map((item) => ({
      kind: item.target.kind,
      field: FIELD_NAME,
      type: FIELD_TYPE,
      status: createdKinds.has(item.target.kind) ? "created" : "present"
    }))
  };
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "ensure";
  if (!["check", "ensure"].includes(command)) {
    throw new Error("用法：ensure-intake-time-fields.js [check|ensure]");
  }
  const result = ensureIntakeTimeFields({
    config: readConfig(),
    ensure: command === "ensure",
    runLark: (args) => defaultRunLark(args)
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  FIELD_NAME,
  FIELD_TYPE,
  ensureIntakeTimeFields,
  fieldName,
  fieldType,
  isCreatedAtField,
  responseItems
};
