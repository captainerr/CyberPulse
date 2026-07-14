// Breach-news RSS aggregation and the Mastodon "Community Pulse" feed.
// The old server kept these in in-memory caches; Workers isolates are ephemeral,
// so the aggregated JSON is cached in the Cache API instead (per-datacenter,
// which is fine for a freshness cache).

import { parseFeed } from './rss.js';

const BREACHES_CACHE_TTL_S = 30 * 60;
const SOCIAL_CACHE_TTL_S = 10 * 60;
const SOCIAL_MAX_ITEMS = 40;
const SOCIAL_MAX_PER_AUTHOR = 3; // keep the feed diverse — no single bot can flood it
const SOCIAL_TEXT_MAX = 280;

const DEFAULT_FEEDS =
  'https://krebsonsecurity.com/feed/,https://thehackernews.com/feeds/posts/default,https://www.securityweek.com/rss,https://www.darkreading.com/rss.xml,https://violationtracker.goodjobsfirst.org/rss,https://www.bleepingcomputer.com/feed/,https://www.zdnet.com/topic-security/rss.xml';
const DEFAULT_FILTER =
  'hack, hacked, hacking, breach, breached, compromised, exploit, exploited, ransomware, data leak, data breach, leak, credentials, exposed, security incident, incident, zero-day';
const DEFAULT_EXCLUDE =
  'tutorial, guide, walkthrough, how to, introduction, beginner, basics, fundamentals, course, lesson, training, workshop, cheat sheet, tips, tricks, best practices, overview, explained, understanding';
const DEFAULT_TRUSTED =
  'Krebs on Security,The Hacker News,BleepingComputer,SecurityWeek,Dark Reading,Violation Tracker,ZDNet';

const csv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

async function cacheGetJson(key) {
  try {
    const hit = await caches.default.match(new Request(key));
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function cachePutJson(key, data, ttlSeconds) {
  try {
    await caches.default.put(
      new Request(key),
      new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `s-maxage=${ttlSeconds}` },
      }),
    );
  } catch {
    // cache is best-effort
  }
}

/** True if an item looks like a real breach/incident story from a trusted source. */
export function makeIsBreachRelated(env) {
  const filter = csv((env.BREACHES_FILTER || DEFAULT_FILTER).toLowerCase());
  const exclude = csv((env.BREACHES_EXCLUDE || DEFAULT_EXCLUDE).toLowerCase());
  const trusted = csv(env.TRUSTED_BREACH_SOURCES || DEFAULT_TRUSTED);
  return (item) => {
    if (!trusted.includes(item.source)) return false;
    const text = (item.title + ' ' + item.contentSnippet).toLowerCase();
    return filter.some((kw) => text.includes(kw)) && !exclude.some((kw) => text.includes(kw));
  };
}

/**
 * Aggregate the configured RSS feeds (last 30 days, deduped, newest first),
 * cached for BREACHES_CACHE_TTL_S. Returns the full item list; callers apply
 * the isBreachRelated filter when they want only incident-related items.
 */
export async function getBreachItems(env) {
  const cacheKey = 'https://kevmap.cache/breaches';
  const cached = await cacheGetJson(cacheKey);
  if (cached?.length) return cached;

  const feeds = csv(env.BREACHES_FEEDS || DEFAULT_FEEDS);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const allItems = [];
  const fetches = feeds.map(async (url) => {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const feed = parseFeed(await res.text());
      allItems.push(
        ...feed.items.map((it) => ({ ...it, source: feed.title || url })),
      );
    } catch (e) {
      console.error(`[breaches] failed to fetch/parse ${url}: ${e?.message ?? e}`);
    }
  });
  await Promise.all(fetches);

  // dedupe by link (or title) and filter to the last 30 days
  const seen = new Set();
  const recent = allItems
    .filter((i) => {
      if (!i.pubDate) return false;
      const t = Date.parse(i.pubDate);
      return !Number.isNaN(t) && t >= cutoff;
    })
    .filter((i) => {
      const key = i.link || i.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));

  if (recent.length) await cachePutJson(cacheKey, recent, BREACHES_CACHE_TTL_S);
  return recent;
}

/** Mastodon status content is HTML; reduce it to plain text for a safe feed preview. */
function htmlToText(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Aggregate recent posts across the configured hashtags, deduped and newest-first. */
export async function getSocialItems(env) {
  const instance = env.MASTODON_INSTANCE || 'https://mastodon.social';
  const cacheKey = 'https://kevmap.cache/social';
  const cached = await cacheGetJson(cacheKey);
  if (cached?.length) return { items: cached, source: instance };

  // Sharp infosec hashtags. (#cybersecurity is intentionally excluded by default —
  // it attracts general news bots; add it back via SOCIAL_TAGS for broader reach.)
  const tags = csv(env.SOCIAL_TAGS || 'infosec,threatintel,malware,ransomware,vulnerability');

  const seen = new Set();
  const seenText = new Set();
  const items = [];
  for (const tag of tags) {
    try {
      const url = `${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=12`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) { console.error(`[social] #${tag}: ${res.status}`); continue; }
      const statuses = await res.json();
      if (!Array.isArray(statuses)) continue;
      for (const s of statuses) {
        if (!s || s.sensitive || seen.has(s.id)) continue;
        const text = htmlToText(s.content);
        if (!text) continue;
        // Collapse the same article reposted across different bot accounts.
        const textKey = text.toLowerCase().replace(/https?:\/\/\S+/g, '')
          .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
        if (textKey && seenText.has(textKey)) continue;
        seen.add(s.id);
        if (textKey) seenText.add(textKey);
        items.push({
          id: s.id,
          url: s.url || s.uri,
          createdAt: s.created_at,
          text: text.length > SOCIAL_TEXT_MAX ? `${text.slice(0, SOCIAL_TEXT_MAX)}…` : text,
          author: s.account?.display_name?.trim() || s.account?.username || 'unknown',
          handle: s.account?.acct ? `@${s.account.acct}` : '',
          tag,
        });
      }
    } catch (e) {
      console.error(`[social] #${tag}:`, e?.message ?? e);
    }
  }

  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  // Cap posts per author (after sort, so each author keeps its most recent) to stop
  // a single high-volume bot from dominating the feed.
  const perAuthor = new Map();
  const diverse = [];
  for (const it of items) {
    const n = perAuthor.get(it.handle) ?? 0;
    if (n >= SOCIAL_MAX_PER_AUTHOR) continue;
    perAuthor.set(it.handle, n + 1);
    diverse.push(it);
  }

  const top = diverse.slice(0, SOCIAL_MAX_ITEMS);
  if (top.length) await cachePutJson(cacheKey, top, SOCIAL_CACHE_TTL_S);
  return { items: top, source: instance };
}
