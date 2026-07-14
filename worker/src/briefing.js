// Executive briefing generation (Groq — OpenAI-compatible chat completions).
// Ports the Express version's guarantees to Workers: one briefing per day, a
// backfill that keeps the trailing 30-day archive gap-free, and grounding that
// only ever cites KEV/breach data that existed as of the briefing's date.
// Single-flight locking and failure cooldown live in the D1 meta table since
// Workers have no shared process state.

import {
  getCatalogEntries, getBriefingDates, hasBriefing,
  saveBriefing, saveHuntingQueries, setMeta, getMeta,
} from './db.js';
import { getBreachItems, makeIsBreachRelated } from './feeds.js';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
// Llama 3.3 70B on Groq's free tier: no credit card, a genuinely recurring daily
// quota, and comfortably more capacity than this workload needs.
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

// After a failed generation, back off before the next attempt. Protects free-tier
// quota: a 429 leaves nothing cached, so without this every trigger would spawn a
// fresh, also-failing Groq call.
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;
// How far back the archive is kept gap-free.
export const BACKFILL_DAYS = 30;
// If an "in flight" lock is older than this, assume the invocation died and steal it.
const INFLIGHT_STALE_MS = 3 * 60 * 1000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const groqModel = (env) => env.GROQ_MODEL || DEFAULT_GROQ_MODEL;

/** Human-friendly attribution for the briefing byline, e.g. "Groq (llama-3.3-70b-versatile)". */
const modelDisplayName = (env) => `Groq (${groqModel(env)})`;

export function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** ISO date `days` before `relativeTo` (defaults to now). */
export function cutoffDate(days, relativeTo) {
  const base = relativeTo ? new Date(`${relativeTo}T00:00:00Z`).getTime() : Date.now();
  return new Date(base - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Build the grounding context: real CISA KEV entries (7 days up to and including
 * the target date, most exploitable first) and real recent breach headlines,
 * both bounded to the target date so a backfilled past day only cites data that
 * existed as of that day.
 */
async function buildBriefingContext(env, targetDateStr) {
  const lines = [];

  const since = cutoffDate(7, targetDateStr);
  const kevs = (await getCatalogEntries(env.DB, since, targetDateStr))
    .sort((a, b) => (b.cve?.epssScore ?? -1) - (a.cve?.epssScore ?? -1))
    .slice(0, 15);
  lines.push(`CISA KEV entries added in the 7 days up to ${targetDateStr} (${kevs.length} shown, highest EPSS first):`);
  if (kevs.length === 0) {
    lines.push('  (none in this window)');
  } else {
    for (const k of kevs) {
      const cvss = k.cve?.baseScore != null ? `CVSS ${k.cve.baseScore} (${k.cve.severity})` : 'CVSS n/a';
      const epss = k.cve?.epssScore != null ? `EPSS ${(k.cve.epssScore * 100).toFixed(1)}%` : 'EPSS n/a';
      const ransom =
        k.knownRansomwareCampaignUse && k.knownRansomwareCampaignUse !== 'Unknown'
          ? ` | Ransomware: ${k.knownRansomwareCampaignUse}`
          : '';
      const desc = (k.shortDescription || k.vulnerabilityName || '').replace(/\s+/g, ' ').slice(0, 180);
      lines.push(
        `  - ${k.cveID} | ${k.vendorProject} ${k.product} | ${cvss} | ${epss} | Added ${k.dateAdded} | Due ${k.dueDate}${ransom} | ${desc}`,
      );
    }
  }

  lines.push('');
  try {
    // The feed cache only ever holds recent items (~30d), so for same-day generation
    // this filter is a no-op; it only bites when backfilling a past date, where it
    // stops the briefing from citing news that hadn't happened yet.
    const targetEnd = new Date(`${targetDateStr}T23:59:59Z`).getTime();
    const isBreachRelated = makeIsBreachRelated(env);
    const breaches = (await getBreachItems(env))
      .filter(isBreachRelated)
      .filter((b) => !b.pubDate || Date.parse(b.pubDate) <= targetEnd)
      .slice(0, 12);
    lines.push(`Recent breach/incident news headlines as of ${targetDateStr} (${breaches.length} shown, newest first):`);
    if (breaches.length === 0) {
      lines.push('  (none available)');
    } else {
      for (const b of breaches) {
        const date = b.pubDate ? new Date(b.pubDate).toISOString().slice(0, 10) : 'n/a';
        lines.push(`  - "${b.title}" — ${b.source} (${date})`);
      }
    }
  } catch {
    lines.push('Recent breach/incident news headlines: (feed unavailable)');
  }

  return lines.join('\n');
}

/** The standing briefing prompt, grounded in real KEVMap data. */
function briefingPrompt(env, humanDate, context) {
  return `Write a professional cybersecurity intelligence briefing for ${humanDate}. Act as a top analyst in cybersecurity with 20 years of experience. Don't include a sensitivity label or email header.

ATTRIBUTION: Although you write in the voice of a senior analyst, the briefing's header byline must read exactly: "Prepared by: ${modelDisplayName(env)}, grounded in KEVMap data". Do NOT sign it as a named human or invent an analyst persona, name, or job title.

ACCURACY REQUIREMENTS (critical — a live SOC relies on this):
- Never output placeholder or invented identifiers. Every CVE ID must be a real, published identifier with a numeric sequence (e.g., CVE-2024-3094). Never write letter-based or template IDs such as CVE-2026-ABCD, CVE-XXXX, or CVE-YYYY-NNNN.
- The "Vulnerability Intelligence" and "Breach Deep-Dive" sections must use ONLY the real records in the DATA block below. Do not introduce any CVE, vendor, product, or breach that is not present there. If the data is sparse, say so plainly rather than inventing entries.
- In the other sections (Threat Actor Profiles, Geopolitical Context), only name groups, campaigns, or events that genuinely exist — prefer well-documented MITRE ATT&CK groups. If you are not confident a specific fact is real, mark it "[unverified]" instead of asserting it.

=== DATA (real and current — from the CISA KEV catalog and breach news feeds) ===
${context}
=== END DATA ===

FORMATTING: Begin with a title line and the "Prepared by:" byline (these come BEFORE the first section). Then render each major section below as a level-2 Markdown heading using these EXACT titles, unnumbered: "## Executive Summary", "## Breach Deep-Dive", "## Threat Actor Profiles", "## Vulnerability Intelligence", "## Strategic Recommendations", "## Geopolitical Context", "## Detection Queries". Within Detection Queries, keep the three platform subsections as level-4 headings (####).

Please include:
Executive Summary: The 'Top 3' most critical shifts in the threat landscape today.
Breach Deep-Dive: Analyze breaches drawn from the breach headlines in the DATA block, including a 'Root Cause' assessment (e.g., MFA fatigue, supply chain, unpatched edge device).
Threat Actor Profiles: Focus on active groups, their current TTPs mapped to MITRE ATT&CK, and their targeted industries.
Vulnerability Intelligence: From the CISA KEV entries in the DATA block, highlight the most critical ones, each with a 'Time-to-Exploit' estimate informed by the provided EPSS score and specific remediation steps. Cite the real CVE IDs exactly as given.
Strategic Recommendations: Three immediate actions for the SOC and one 'Long-term Strategic Pivot' for the leadership team.
Geopolitical Context: Briefly mention if any global events (wars, elections, summits) are driving these specific attacks.
Detection Queries: Provide ready-to-adapt hunting/detection queries for the specific threats, CVEs, malware, and TTPs covered above. Include three subsections, each with EXACTLY 3 queries, and EACH QUERY MUST BE IN ITS OWN SEPARATE FENCED CODE BLOCK — never combine two or more queries into a single code block, even if they're for the same platform. That means 9 separate fenced code blocks total (3 platforms x 3 queries each):
  - "Microsoft Sentinel & Defender XDR (KQL)": 3 separate \`\`\`kql blocks. Favor the shared Advanced Hunting schema (DeviceProcessEvents, DeviceFileEvents, DeviceNetworkEvents) so the same query runs in BOTH Sentinel and Defender XDR. If a query must use a Sentinel-only table (e.g., SecurityEvent, Syslog, CommonSecurityLog) that does not exist in Defender XDR Advanced Hunting, add the comment "// Sentinel-only: no Defender XDR equivalent table" at the top of that query's block.
  - "Cortex XDR (XQL)": 3 separate \`\`\`xql blocks, using dataset = xdr_data.
  - "Splunk (SPL)": 3 separate \`\`\`spl blocks.
Tie each query to a concrete item from this briefing (e.g., SimpleHelp auth-bypass exploitation, the named stealer/miner activity, or a specific CVE/MITRE technique). Requirements for each query:
  - Write it CLEAN and copy-paste-runnable, using the standard/common schema for that platform. Do NOT insert inline placeholders or [verify] tags inside the query body — the query must run as written against a standard schema.
  - One-line comment at the top of the block stating what it hunts for.
  - Immediately AFTER each individual code block (once per query, not once per platform), add this exact italic line on its own: "_Validate before use: <the 1-3 specific tables/fields/indexes/watchlists the analyst must confirm or populate>_".
State once at the top of the section that these are starting templates to be validated against the reader's own environment.
Tone: Authoritative, concise, and action-oriented. Use bullet points for readability.`;
}

/** Call Groq's OpenAI-compatible chat completions endpoint and return the briefing text (markdown). */
async function fetchGroqCompletion(env, prompt) {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('GROQ_API_KEY is not set');

  const res = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: groqModel(env), messages: [{ role: 'user', content: prompt }] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq API error: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) {
    // No text usually means a content filter or a non-"stop" finish reason — surface it.
    const reason = data?.choices?.[0]?.finish_reason || 'empty response';
    throw new Error(`Groq returned no text (${reason})`);
  }
  return text;
}

/**
 * Split Groq's single generated document into the narrative briefing and the
 * "## Detection Queries" section, which lives on its own archived Hunting page.
 * The three platform subsections are promoted from H4 to H2 so they work as the
 * Hunting page's own top-level sections. Falls back to leaving the full text in
 * the briefing (logging a warning) if the expected heading isn't found, so a
 * model deviation never silently drops content.
 */
export function splitDetectionQueries(fullContent) {
  const marker = /^##\s+Detection Queries\s*$/m;
  const match = marker.exec(fullContent);
  if (!match) {
    console.warn('[briefing] "## Detection Queries" heading not found — leaving queries embedded in the briefing');
    return { briefingContent: fullContent, huntingContent: null };
  }
  const briefingContent = fullContent.slice(0, match.index).trimEnd();
  const huntingContent = fullContent
    .slice(match.index + match[0].length)
    .trimStart()
    .replace(/^####\s+/gm, '## ');
  return { briefingContent, huntingContent };
}

/** Generate and persist the briefing (and its split-out hunting queries) for the given date. */
export async function generateBriefing(env, dateStr) {
  const humanDate = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  const context = await buildBriefingContext(env, dateStr);
  const fullContent = await fetchGroqCompletion(env, briefingPrompt(env, humanDate, context));
  const { briefingContent, huntingContent } = splitDetectionQueries(fullContent);
  const generatedAt = Date.now();
  await saveBriefing(env.DB, { date: dateStr, content: briefingContent, model: groqModel(env), generatedAt });
  if (huntingContent) {
    await saveHuntingQueries(env.DB, { date: dateStr, content: huntingContent, model: groqModel(env), generatedAt });
  }
  return briefingContent;
}

/** True if generation should be skipped right now (recent failure, or another invocation is at it). */
async function briefingBlocked(env) {
  const failedAt = Number(await getMeta(env.DB, 'briefing_failed_at')) || 0;
  if (Date.now() - failedAt < RETRY_COOLDOWN_MS) return true;
  const inflightAt = Number(await getMeta(env.DB, 'briefing_inflight_at')) || 0;
  return Date.now() - inflightAt < INFLIGHT_STALE_MS;
}

/**
 * Fill missing briefings in the trailing BACKFILL_DAYS window (today included),
 * newest-missing-first, bounded to `maxCalls` Groq calls. Meta-table lock and
 * failure cooldown keep overlapping triggers (cron ticks, the daily trigger, and
 * the lazy today-generation on page load) from piling up concurrent Groq calls.
 * Whatever doesn't fit is picked up by the next tick.
 */
export async function backfillMissingBriefings(env, maxCalls) {
  if (!env.GROQ_API_KEY?.trim()) return 0; // no key → leave archive empty, surfaced in UI
  if (await briefingBlocked(env)) return 0;

  const existing = new Set(await getBriefingDates(env.DB));
  const missing = [];
  for (let i = 0; i < BACKFILL_DAYS; i++) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    if (!existing.has(d)) missing.push(d);
  }
  if (!missing.length) return 0;

  const toGenerate = missing.slice(0, maxCalls);
  if (missing.length > toGenerate.length) {
    console.log(`[briefing] backfill: ${missing.length} missing in last ${BACKFILL_DAYS}d — generating ${toGenerate.length} now, rest next tick`);
  }

  await setMeta(env.DB, 'briefing_inflight_at', Date.now());
  let generated = 0;
  try {
    for (const date of toGenerate) {
      try {
        await generateBriefing(env, date);
        await setMeta(env.DB, 'briefing_failed_at', 0);
        generated++;
        console.log(`[briefing] backfill: generated ${date}`);
      } catch (err) {
        await setMeta(env.DB, 'briefing_failed_at', Date.now());
        console.error(`[briefing] backfill failed for ${date} (cooling off): ${err.message}`);
        break; // stop this sweep; cooldown + the next tick will retry
      }
      if (generated < toGenerate.length) await delay(2000);
    }
  } finally {
    await setMeta(env.DB, 'briefing_inflight_at', 0);
  }
  return generated;
}

/**
 * Generate today's briefing if it's missing — the one case worth a page load
 * awaiting (bounded to a single Groq call). Shares the lock/cooldown with the
 * backfill so it can never race a concurrent sweep.
 */
export async function ensureTodayBriefing(env) {
  const today = todayStr();
  if (!env.GROQ_API_KEY?.trim()) return;
  if (await hasBriefing(env.DB, today)) return;
  if (await briefingBlocked(env)) return;

  await setMeta(env.DB, 'briefing_inflight_at', Date.now());
  try {
    await generateBriefing(env, today);
    await setMeta(env.DB, 'briefing_failed_at', 0);
    console.log(`[briefing] generated ${today}`);
  } catch (err) {
    await setMeta(env.DB, 'briefing_failed_at', Date.now());
    console.error(`[briefing] generation failed for ${today} (cooling off): ${err.message}`);
  } finally {
    await setMeta(env.DB, 'briefing_inflight_at', 0);
  }
}
