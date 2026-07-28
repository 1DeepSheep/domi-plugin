const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FIELD_NAME,
  FIELD_TYPE,
  ensureIntakeTimeFields
} = require("../skills/investment-mgmt/scripts/ensure-intake-time-fields.js");

const CONFIG = {
  storageBackend: "feishu",
  projectBaseToken: "example",
  projectTableId: "table_id",
  peopleBaseToken: "placeholder",
  peopleTableId: "table_id"
};

function fakeLark(initial = {}) {
  const fields = new Map([
    ["example", [...(initial.projects || [])]],
    ["placeholder", [...(initial.people || [])]]
  ]);
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      const base = args[args.indexOf("--base-token") + 1];
      if (args.includes("+field-list")) {
        return { data: { items: fields.get(base) } };
      }
      if (args.includes("+field-create")) {
        const definition = JSON.parse(args[args.indexOf("--json") + 1]);
        fields.get(base).push({ name: definition.name, type: definition.type });
        return { created: true };
      }
      throw new Error(`Unexpected lark call: ${args.join(" ")}`);
    }
  };
}

test("missing project and people intake fields are created once and verified", () => {
  const lark = fakeLark();
  const result = ensureIntakeTimeFields({
    config: CONFIG,
    runLark: (args) => lark.run(args)
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.tables.map((item) => [item.kind, item.field, item.type, item.status]),
    [
      ["project", FIELD_NAME, FIELD_TYPE, "created"],
      ["people", FIELD_NAME, FIELD_TYPE, "created"]
    ]
  );
  assert.equal(lark.calls.filter((args) => args.includes("+field-create")).length, 2);

  const repeated = ensureIntakeTimeFields({
    config: CONFIG,
    runLark: (args) => lark.run(args)
  });
  assert.deepEqual(repeated.tables.map((item) => item.status), ["present", "present"]);
  assert.equal(lark.calls.filter((args) => args.includes("+field-create")).length, 2);
});

test("a same-name writable field blocks all schema writes", () => {
  const lark = fakeLark({
    projects: [{ name: FIELD_NAME, type: "datetime" }]
  });

  assert.throws(
    () => ensureIntakeTimeFields({
      config: CONFIG,
      runLark: (args) => lark.run(args)
    }),
    /不是系统创建时间字段/
  );
  assert.equal(lark.calls.some((args) => args.includes("+field-create")), false);
});

test("check mode reports missing fields without writing", () => {
  const lark = fakeLark({
    projects: [{ name: FIELD_NAME, type: FIELD_TYPE }]
  });
  const result = ensureIntakeTimeFields({
    config: CONFIG,
    ensure: false,
    runLark: (args) => lark.run(args)
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.tables.map((item) => item.status), ["present", "missing"]);
  assert.equal(lark.calls.some((args) => args.includes("+field-create")), false);
});

test("local repositories skip Feishu schema operations", () => {
  const result = ensureIntakeTimeFields({
    config: { storageBackend: "local" },
    runLark: () => {
      throw new Error("must not run");
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});
