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
  if (!/融资|FUNDING|FINANCING|RAISE[DS]?\b/.test(text)) return null;
  // A/A+, several rounds and historical comparisons need semantic review, not guesses.
  if (/多轮|数轮|连续|[A-Z](?:-?\d+)?\+?\s*[、/及与和]\s*[A-Z]/.test(text)) return null;
  const rounds = [...text.matchAll(/(?:^|[^A-Z0-9])((?:PRE[\s-]*)?[A-Z](?:-?\d{1,2})?\+{0,2})\s*轮/g),
    ...text.matchAll(/\bSERIES\s+((?:PRE[\s-]*)?[A-Z](?:-?\d{1,2})?\+{0,2})(?![A-Z0-9+-])/g)]
    .map(match => match[1].replace(/[\s-]+/g, ""));
  const unique = [...new Set(rounds)];
  if (unique.length !== 1) return null;
  return `${unique[0]}${/轮\s*系列|系列\s*融资/.test(text) ? ":series" : ":single"}`;
}

function duplicateReason(input, existing) {
  const currentEntities = entities(input.companies), previousEntities = entities(existing.companies);
  const sameEntities = currentEntities.length > 0 && JSON.stringify(currentEntities) === JSON.stringify(previousEntities);
  const sameTitle = normalized(input.title) === normalized(existing.title);
  const url = canonicalUrl(input.url);
  const round = fundingRound(input.title), previousRound = fundingRound(existing.title);
  // One article may report multiple transactions. Different explicit rounds remain separate.
  if (round && previousRound && round !== previousRound) return null;
  if (url && url === canonicalUrl(existing.url) && (sameEntities
    || (!currentEntities.length && !previousEntities.length && sameTitle))) return "same_source";
  return sameEntities && round && round === previousRound ? "same_entity_funding_round" : null;
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
