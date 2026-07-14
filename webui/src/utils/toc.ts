import GithubSlugger from 'github-slugger';

export interface TocItem {
  id: string;
  text: string;
}

/**
 * Extract level-2 section headings from briefing markdown, computing the same
 * slug ids that rehype-slug assigns (a single GithubSlugger advanced over every
 * heading in document order, so dedupe counters stay in sync). Headings inside
 * fenced code blocks — e.g. the '#'-prefixed comments in SPL queries — are skipped.
 */
export function extractToc(markdown: string): TocItem[] {
  const slugger = new GithubSlugger();
  const items: TocItem[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, '').trim();
    const id = slugger.slug(text); // advance for every heading to mirror rehype-slug
    if (m[1].length === 2 && text) items.push({ id, text });
  }
  return items;
}

/** Split briefing markdown into the intro (before the first H2) and the body (from it). */
export function splitIntro(markdown: string): { intro: string; body: string } {
  const idx = markdown.search(/^##\s/m);
  if (idx < 0) return { intro: '', body: markdown };
  return { intro: markdown.slice(0, idx), body: markdown.slice(idx) };
}

export interface Section {
  heading: string;
  content: string; // markdown from (and including) the heading line up to the next H2
}

/**
 * Split markdown into top-level (H2) sections, each still containing its own
 * heading line — render each chunk as its own ReactMarkdown call to wrap it in a
 * bordered box (e.g. one box per hunting-query platform). Fence-aware like
 * extractToc, so a '#'-prefixed comment inside a query's code block never starts
 * a new section.
 */
export function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: string[] | null = null;
  let currentHeading = '';
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const headingMatch = !inFence && /^##\s+(.+?)\s*#*$/.exec(line);
    if (headingMatch) {
      if (current) sections.push({ heading: currentHeading, content: current.join('\n') });
      currentHeading = headingMatch[1].replace(/[*_`]/g, '').trim();
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) sections.push({ heading: currentHeading, content: current.join('\n') });
  return sections;
}

export interface QueryRow {
  date: string;
  platform: string;
  language: string;
  index: number; // 1-based position within its platform section
  query: string;
  validate: string; // the "Validate before use: ..." note, if present
}

/**
 * Extract individual queries (one row per fenced code block) from a day's hunting
 * markdown, for CSV export. Walks each platform section from splitSections and
 * pairs every code block with the "_Validate before use: ..._" line that follows
 * it (per the briefing prompt's required format), tolerating its absence.
 */
export function extractQueries(markdown: string, date: string): QueryRow[] {
  const rows: QueryRow[] = [];
  for (const section of splitSections(markdown)) {
    const lines = section.content.split('\n');
    let index = 0;
    let i = 0;
    while (i < lines.length) {
      const fenceStart = /^```(\w+)\s*$/.exec(lines[i]);
      if (!fenceStart) { i++; continue; }
      const language = fenceStart[1];
      const queryLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        queryLines.push(lines[i]);
        i++;
      }
      i++; // skip the closing ```
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j++;
      let validate = '';
      const validateMatch = j < lines.length ? /^_Validate before use:\s*(.*?)_?\s*$/.exec(lines[j]) : null;
      if (validateMatch) {
        validate = validateMatch[1];
        i = j + 1;
      }
      index++;
      rows.push({ date, platform: section.heading, language, index, query: queryLines.join('\n').trim(), validate });
    }
  }
  return rows;
}
