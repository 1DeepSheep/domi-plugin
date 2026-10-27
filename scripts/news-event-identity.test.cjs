const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork, spawnSync } = require("node:child_process");
const test = require("node:test");
const { DomiRepository } = require("./domi-repo.cjs");
const { verifyNewsSourceDate } = require("./news-source-date.cjs");
const { fundingRound, canonicalUrl } = require("./news-event-identity.cjs");
const { mockPublicSource } = require("./test-helpers/news-source-fetch.cjs");

const event = extra => ({ eventId: "evt_first", title: "示例材料完成超2亿元A轮系列融资，升级研发平台",
  companies: "深圳示例材料科技有限公司", types: ["融资"], publishedAt: "2026-10-22T10:00:00+08:00",
  summary: "本轮资金用于产品开发。", url: "https://first.example.com/article/one", ...extra });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-news-dedupe-"));
  const config = { backend: "local", databasePath: path.join(root, "repo.sqlite3"), libraryDir: path.join(root, "library") };
  const repository = new DomiRepository(config);
  t.after(() => { repository.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, config, repository };
}
async function receipt(repository, input) {
  const source = mockPublicSource(`<head><meta property="article:published_time" content="${input.publishedAt}"></head>`);
  return verifyNewsSourceDate(input, repository.getNews(input.eventId), source.options);
}
async function upsert(repository, input) {
  return repository.upsertNews(input, { dateReceipt: await receipt(repository, input) });
}
const newsFiles = repository => fs.readdirSync(path.join(repository.libraryDir, "2.行业动态"), { recursive: true })
  .filter(name => name.endsWith(".md") || name.endsWith(".tmp"));

function childWriter(config, input, env = {}) {
  const inputPath = path.join(path.dirname(config.databasePath), "child-input.json");
  fs.writeFileSync(inputPath, JSON.stringify(input));
  const child = `
    const fs=require('node:fs');
    const {DomiRepository}=require(${JSON.stringify(path.join(__dirname,"domi-repo.cjs"))});
    const {verifyNewsSourceDate}=require(${JSON.stringify(path.join(__dirname,"news-source-date.cjs"))});
    const {mockPublicSource}=require(${JSON.stringify(path.join(__dirname,"test-helpers/news-source-fetch.cjs"))});
    (async()=>{const repository=new DomiRepository(${JSON.stringify(config)});
      repository.database.exec('PRAGMA max_page_count = 1073741823');
      try {const input=JSON.parse(fs.readFileSync(${JSON.stringify(inputPath)},'utf8'));
        const dateReceipt=await verifyNewsSourceDate(input,null,mockPublicSource('<head><meta property="article:published_time" content="'+input.publishedAt+'"></head>').options);
        repository.upsertNews(input,{dateReceipt});console.log(JSON.stringify({ok:true}));
      } catch(error){console.log(JSON.stringify({ok:false,code:error.code,message:error.message}));}
      finally{repository.close();}})().catch(error=>{console.error(error);process.exitCode=1});
  `;
  const result = spawnSync(process.execPath, ["-e", child], { encoding: "utf8", timeout: 8000, env: { ...process.env, ...env } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

test("different titles and publishers cannot create a second ID for the same entity and explicit round", async t => {
  const { repository } = fixture(t);
  const first = await upsert(repository, event());
  const bytes = fs.readFileSync(first.event.documentPath);
  for (const [id, title, url] of [
    ["evt_second", "示例材料完成超2亿元A轮系列融资，扩建中试产线", "https://second.example.com/report/two"],
    ["evt_third", "示例材料获A轮系列融资，推进新产品开发", "https://third.example.com/story/three"]
  ]) {
    await assert.rejects(upsert(repository, event({ eventId: id, title, url })), error => {
      assert.equal(error.code, "DOMI_NEWS_POSSIBLE_DUPLICATE");
      assert.deepEqual(error.duplicateCandidates.map(item => item.eventId), ["evt_first"]);
      return true;
    });
    assert.equal(repository.getNews(id), null);
  }
  assert.equal(repository.database.prepare("SELECT COUNT(*) count FROM news_events").get().count, 1);
  assert.equal(newsFiles(repository).length, 1);
  assert.deepEqual(fs.readFileSync(first.event.documentPath), bytes);
});

test("different explicit rounds, different entities, and distant announcements remain separate", async t => {
  const { repository } = fixture(t);
  for (const round of ["A", "A+", "A1", "B", "Pre–A"]) {
    await upsert(repository, event({ eventId: `evt_${round}`, title: `示例材料完成${round}轮融资` }));
  }
  await upsert(repository, event({ eventId: "evt_other", companies: "杭州另一材料有限公司", title: "另一材料完成A轮融资" }));
  await upsert(repository, event({ eventId: "evt_later", title: "示例材料完成A轮融资", publishedAt: "2026-12-22T10:00:00+08:00", url: "https://first.example.com/later-event" }));
  assert.equal(repository.database.prepare("SELECT COUNT(*) count FROM news_events").get().count, 7);
  assert.equal(fundingRound("示例材料完成A、A+两轮融资"), null);
  assert.equal(fundingRound("示例材料完成多轮融资"), null);
  assert.equal(fundingRound("Anonymous raises Series A-1 funding"), "A1:single");
  assert.equal(fundingRound("示例材料完成Pre–A轮融资"), "PREA:single");
  assert.notEqual(fundingRound("Anonymous raises Series A-1 funding"), fundingRound("Anonymous raises Series A funding"));
});

test("ambiguous rounds are not guessed from title similarity", async t => {
  const { repository } = fixture(t);
  await upsert(repository, event({ title: "示例材料完成多轮融资" }));
  await upsert(repository, event({ eventId: "evt_other", title: "示例材料完成融资", url: "https://other.example.com/report" }));
  assert.equal(repository.database.prepare("SELECT COUNT(*) count FROM news_events").get().count, 2);
});

test("canonical source URLs catch reposted links without treating different entities as one", async t => {
  const { repository } = fixture(t);
  const first = event({ title: "示例材料发布研发产品", url: "https://first.example.com/article/one?item=1&utm_source=a#top" });
  await upsert(repository, first);
  const second = event({ eventId: "evt_other", title: "示例材料的新产品正式发布", url: "https://first.example.com/article/one?from=feed&item=1" });
  await assert.rejects(upsert(repository, second), { code: "DOMI_NEWS_POSSIBLE_DUPLICATE" });
  await upsert(repository, { ...second, companies: "杭州另一材料有限公司", title: "另一材料发布新产品" });
  assert.equal(canonicalUrl(first.url), canonicalUrl(second.url));
});

test("the same source URL is checked across years even when tracking parameters change", async t => {
  const { repository } = fixture(t);
  await upsert(repository, event({ url: "https://first.example.com/article/one?utm_source=a&item=1" }));
  for (const url of ["https://first.example.com/article/one?utm_source=a&item=1", "https://first.example.com/article/one?item=1&from=feed#top"]) {
    await assert.rejects(upsert(repository, event({ eventId: "evt_past", publishedAt: "2025-10-22T10:00:00+08:00", url })),
      error => error.code === "DOMI_NEWS_POSSIBLE_DUPLICATE" && error.duplicateCandidates[0].reason === "same_source");
  }
  assert.equal(newsFiles(repository).length, 1);
});

test("existing IDs accept verified incremental updates but never bypass source-date verification", async t => {
  const { repository } = fixture(t);
  await upsert(repository, event());
  const update = event({ summary: "补充中试产线及产品进度。", url: "https://second.example.com/new-source" });
  assert.throws(() => repository.upsertNews(update), { code: "DOMI_NEWS_DATE_UNVERIFIED" });
  const result = await upsert(repository, update);
  assert.equal(result.action, "updated");
  assert.equal(result.event.summary, update.summary);
  await upsert(repository, update);
  assert.equal(repository.database.prepare("SELECT COUNT(*) count FROM news_events").get().count, 1);
  assert.equal(newsFiles(repository).length, 1);
});

test("failed transactions remove new Markdown and restore existing bytes and rows", async t => {
  const { repository } = fixture(t);
  const first = await upsert(repository, event());
  const before = fs.readFileSync(first.event.documentPath);
  const exec = repository.database.exec.bind(repository.database);
  repository.database.exec = sql => { if (sql === "COMMIT") throw new Error("synthetic commit failure"); return exec(sql); };
  await assert.rejects(upsert(repository, event({ summary: "不得持久化" })), /synthetic commit failure/);
  assert.deepEqual(fs.readFileSync(first.event.documentPath), before);
  assert.equal(repository.getNews("evt_first").summary, first.event.summary);
  await assert.rejects(upsert(repository, event({ eventId: "evt_new", companies: "另一家公司", url: "https://other.example.com/new" })), /synthetic commit failure/);
  repository.database.exec = exec;
  assert.equal(repository.getNews("evt_new"), null);
  assert.equal(newsFiles(repository).length, 1);
  assert.equal(repository.database.prepare("SELECT COUNT(*) count FROM news_source_date_evidence WHERE event_id='evt_new'").get().count, 0);
});

test("rollback never overwrites a concurrent human document edit", async t => {
  const { repository } = fixture(t);
  const first = await upsert(repository, event());
  const exec = repository.database.exec.bind(repository.database);
  repository.database.exec = sql => {
    if (sql === "COMMIT") { fs.writeFileSync(first.event.documentPath, "用户并发补充内容"); throw new Error("synthetic commit failure"); }
    return exec(sql);
  };
  await assert.rejects(upsert(repository, event({ summary: "自动更新" })), /未覆盖该文件/);
  repository.database.exec = exec;
  assert.equal(fs.readFileSync(first.event.documentPath, "utf8"), "用户并发补充内容");
  assert.equal(repository.getNews("evt_first").summary, first.event.summary);
});

test("a writer cannot take over until rollback compensation has released the process lock", async t => {
  const { repository, config } = fixture(t);
  const input = event();
  const dateReceipt = await receipt(repository, input);
  const exec = repository.database.exec.bind(repository.database);
  let competing;
  repository.database.exec = sql => {
    if (sql === "COMMIT") throw new Error("synthetic commit failure");
    const result = exec(sql);
    if (sql === "ROLLBACK") competing = childWriter(config, input);
    return result;
  };
  assert.throws(() => repository.upsertNews(input, { dateReceipt }), /synthetic commit failure/);
  repository.database.exec = exec;
  assert.equal(competing.code, "DOMI_NEWS_WRITE_BUSY");
  assert.equal(repository.getNews(input.eventId), null);
  assert.equal(childWriter(config, input).ok, true);
  const committed = repository.getNews(input.eventId);
  assert.ok(committed);
  assert.equal(fs.existsSync(committed.documentPath), true);
  assert.equal(newsFiles(repository).length, 1);
});

test("SQLITE_FULL automatic rollback cannot let a competing process race document compensation", async t => {
  const { repository, config, root } = fixture(t);
  const childTmp = path.join(root, "child-tmp");
  fs.mkdirSync(childTmp);
  const input = event({ summary: "x".repeat(1024 * 1024) });
  const dateReceipt = await receipt(repository, input);
  const pages = repository.database.prepare("PRAGMA page_count").get().page_count;
  repository.database.exec(`PRAGMA max_page_count = ${pages}`);
  const prepare = repository.database.prepare.bind(repository.database);
  let competing, automaticRollback = false;
  repository.database.prepare = sql => {
    const statement = prepare(sql);
    if (/INSERT INTO news_events/.test(sql)) {
      const run = statement.run.bind(statement);
      statement.run = (...args) => {
        try { return run(...args); }
        catch (error) {
          automaticRollback = !repository.database.isTransaction;
          competing = childWriter(config, input, { TMPDIR: childTmp, HOME: childTmp });
          throw error;
        }
      };
    }
    return statement;
  };
  assert.throws(() => repository.upsertNews(input, { dateReceipt }), /database or disk is full/);
  repository.database.prepare = prepare;
  assert.equal(automaticRollback, true);
  assert.equal(competing.code, "DOMI_NEWS_WRITE_BUSY");
  assert.equal(repository.getNews(input.eventId), null);
  assert.equal(newsFiles(repository).length, 0);
  assert.equal(childWriter(config, input).ok, true);
  const committed = repository.getNews(input.eventId);
  assert.equal(committed.summary, input.summary);
  assert.equal(fs.existsSync(committed.documentPath), true);
  assert.equal(newsFiles(repository).length, 1);
});

test("two concurrent processes cannot archive the same funding event under different IDs", async t => {
  const { repository, root, config } = fixture(t);
  const childScript = path.join(root, "writer.cjs");
  fs.writeFileSync(childScript, `
    const {DomiRepository}=require(${JSON.stringify(path.join(__dirname,"domi-repo.cjs"))});
    const {verifyNewsSourceDate}=require(${JSON.stringify(path.join(__dirname,"news-source-date.cjs"))});
    const {mockPublicSource}=require(${JSON.stringify(path.join(__dirname,"test-helpers/news-source-fetch.cjs"))});
    (async()=>{
      const repository=new DomiRepository(JSON.parse(process.argv[2]));
      const input=JSON.parse(process.argv[3]);
      const dateReceipt=await verifyNewsSourceDate(input,null,mockPublicSource('<head><meta property="article:published_time" content="'+input.publishedAt+'"></head>').options);
      const newsPage=repository.newsPage.bind(repository);
      repository.newsPage=(...args)=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);return newsPage(...args)};
      process.on('message',()=>{
        let result;try{repository.upsertNews(input,{dateReceipt});result={ok:true}}catch(error){result={ok:false,code:error.code}}
        repository.close();process.send(result,()=>process.exit(0));
      });
      process.send({ready:true});
    })().catch(error=>{process.send({error:error.message},()=>process.exit(1))});
  `);
  const children = ["one", "two"].map(id => fork(childScript, [JSON.stringify(config), JSON.stringify(event({ eventId: `evt_${id}`, url: `https://${id}.example.com/article` }))], { stdio: ["ignore", "ignore", "ignore", "ipc"] }));
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill(); }));
  const results = children.map(child => new Promise((resolve, reject) => {
    const timer=setTimeout(()=>reject(new Error("concurrent news writer timed out")),10_000);
    child.on("error", reject);
    child.on("message", message=>{if(!message.ready){clearTimeout(timer);if(message.error)reject(new Error(message.error));else resolve(message)}});
  }));
  await Promise.all(children.map(child => new Promise(resolve=>child.on("message",message=>{if(message.ready)resolve()}))));
  children.forEach(child=>child.send("write"));
  const outcomes = await Promise.all(results);
  assert.equal(outcomes.filter(item=>item.ok).length,1);
  assert.equal(outcomes.find(item=>!item.ok).code,"DOMI_NEWS_POSSIBLE_DUPLICATE");
  assert.equal(repository.database.prepare("SELECT COUNT(*) count FROM news_events").get().count,1);
  assert.equal(newsFiles(repository).length,1);
});
