const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function normalized(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s·•]/g, "");
}

function entities(value) {
  // Do not infer brand aliases or strip legal entities: shared words are not identity proof.
  return [...new Set(String(value || "").split(/[;；、\n]+/).map(normalized).filter(Boolean))].sort();
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|from|spm|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search}`;
  } catch { return ""; }
}

function fundingRound(title) {
  const text = String(title || "").normalize("NFKC").toUpperCase().replace(/[‐‑‒–—−]/g, "-");
  const financingIndex = text.search(/融资|FUNDING|FINANCING|RAISE[DS]?\b/);
  if (financingIndex < 0) return null;
  const financingLead = text.slice(0, financingIndex);
  const token = "(?:PRE[\\s-]*)?(?:天使|种子|首|[A-Z](?:-?\\d{1,2})?)\\+*";
  const roundIdentity = round => round.replace(/[\s-]+/g, "")
    .replace("天使", "ANGEL").replace("种子", "SEED").replace("首", "FIRST");
  // Historical comparisons, planned rounds and slash alternatives are not joint announcements.
  if (/此前|曾经|去年|上轮|历史|对比|相比/.test(text)
    || new RegExp(`${token}\\s*/\\s*${token}`).test(text)
    || /计划|拟|将|继|\b(?:PLANS?|PLANNED|INTENDS?|WILL)\b/.test(financingLead)) return null;
  const jointPattern = new RegExp(`(?:^|[^A-Z0-9])(${token}(?:\\s*轮)?(?:\\s*[及与和、]\\s*${token}(?:\\s*轮)?)+\\s*(?:两轮|三轮|轮))`, "g");
  const joint = [...text.matchAll(jointPattern)];
  const rounds = [...text.matchAll(new RegExp(`(?:^|[^A-Z0-9])(${token})\\s*轮`, "g")),
    ...text.matchAll(new RegExp(`\\bSERIES\\s+(${token})(?![A-Z0-9+-])`, "g"))]
    .map(match => roundIdentity(match[1]));
  if (joint.length) {
    if (joint.length !== 1 || /系列|多轮|数轮/.test(financingLead)) return null;
    const explicit = [...new Set(joint[0][1].match(new RegExp(token, "g"))
      .map(roundIdentity))].sort();
    // A partial list plus another round elsewhere may be a recap of different transactions.
    if (explicit.length < 2 || rounds.some(round => !explicit.includes(round))) return null;
    return `${explicit.join("&")}:combined`;
  }
  if (/多轮|数轮|连续/.test(financingLead)
    || /轮\s*[及与和、]/.test(text) || new RegExp(`${token}\\s*[、/及与和]\\s*${token}`).test(text)) return null;
  // Unparsed English combinations must not degrade to the first Series label alone.
  if (new RegExp(`\\bSERIES\\s+${token}\\s*(?:AND|&)\\s*(?:SERIES\\s+)?${token}(?![A-Z0-9+-])`).test(text)) return null;
  const unique = [...new Set(rounds)];
  if (unique.length !== 1) return null;
  return `${unique[0]}${/轮\s*系列|系列\s*融资/.test(text) ? ":series" : ":single"}`;
}

function fundingSubject(title) {
  // Read the literal leading subject; never infer a short name from a legal entity.
  const text = String(title || "").normalize("NFKC").trim();
  const match = text.match(/^(.{2,60}?)(?:宣布(?:连续)?完成|连续完成|完成|获得|获)(?=.{0,60}融资)/);
  if (!match || /[，,。:：;；、/\n]|及|与|和/.test(match[1])) return "";
  const quoted = match[1].trim();
  const pairs = { '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』" };
  const subject = normalized(pairs[quoted[0]] === quoted.at(-1) ? quoted.slice(1, -1) : quoted);
  return /^(?:(?:该|这家|一家|本|某|某家).{0,20})?(?:公司|企业|项目|团队|厂商)$/.test(subject) ? "" : subject;
}

function articleUrl(value) {
  try {
    const url = new URL(value);
    // A feed/home page can contain many changing announcements.
    return !/^\/(?:index\.(?:html?|php))?$/i.test(url.pathname)
      && !/^\/(?:news|feed|rss|search)(?:\.(?:xml|rss|html?))?\/?$/i.test(url.pathname)
      && !/^\/(?:tags?|categor(?:y|ies)|archives?)(?:\/|$)/i.test(url.pathname);
  } catch { return false; }
}

function duplicateReason(input, existing) {
  const currentEntities = entities(input.companies), previousEntities = entities(existing.companies);
  const sameEntities = currentEntities.length > 0 && JSON.stringify(currentEntities) === JSON.stringify(previousEntities);
  const sameTitle = normalized(input.title) === normalized(existing.title);
  const url = canonicalUrl(input.url);
  const round = fundingRound(input.title), previousRound = fundingRound(existing.title);
  // One article may report multiple transactions. Different explicit rounds remain separate.
  if (round && previousRound && round !== previousRound) return null;
  const subject = fundingSubject(input.title);
  const sameFundingSubject = subject && subject === fundingSubject(existing.title);
  if (url && articleUrl(input.url) && url === canonicalUrl(existing.url) && (sameEntities || sameFundingSubject
    || (!currentEntities.length && !previousEntities.length && sameTitle))) return "same_source";
  if (sameEntities && round && round === previousRound) return "same_entity_funding_round";
  // Equal literal headline subjects are review candidates, not proof that legal names are aliases.
  return sameFundingSubject && round && round === previousRound ? "same_subject_funding_round" : null;
}

function assertNoDuplicateNews(database, input, eventId, publishedAt) {
  // Existing IDs are intentional incremental updates; this guard only prevents new aliases.
  if (database.prepare("SELECT 1 FROM news_events WHERE event_id = ?").get(eventId)) return;
  let prefixes = ["", ""];
  try {
    const url = new URL(input.url);
    const base = `//${url.host}${url.pathname}`.replace(/[\\%_]/g, "\\$&");
    prefixes = [`http:${base}%`, `https:${base}%`];
  } catch {}
  const rows = database.prepare(`
    SELECT event_id, title, companies, url, published_at
    FROM news_events WHERE (published_at >= ? AND published_at <= ?)
      OR url = ? OR url LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\'
    ORDER BY created_at, event_id
  `).all(publishedAt - WINDOW_MS, publishedAt + WINDOW_MS, String(input.url || ""), ...prefixes);
  const duplicateCandidates = rows.flatMap(row => {
    const reason = duplicateReason(input, row);
    const inWindow = Math.abs(row.published_at - publishedAt) <= WINDOW_MS;
    return reason && (reason === "same_source" || inWindow)
      ? [{ eventId: row.event_id, title: row.title, url: row.url, publishedAt: row.published_at, reason }] : [];
  });
  if (duplicateCandidates.length) {
    throw Object.assign(new Error("发现疑似同一新闻事件；请先回读既有记录，核实后复用其 eventId 更新来源与信息增量，不得另建重复事件。"), {
      code: "DOMI_NEWS_POSSIBLE_DUPLICATE", duplicateCandidates
    });
  }
}

module.exports = { assertNoDuplicateNews, canonicalUrl, fundingRound, duplicateReason };
