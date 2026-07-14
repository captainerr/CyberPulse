// Minimal dependency-free RSS 2.0 / Atom parser. Workers can't run rss-parser
// (it drives Node's http stack), and the handful of security-news feeds we
// aggregate are all plain RSS/Atom, so light tag extraction is enough: we only
// need title, link, publication date, and a plain-text snippet per item.

function decodeEntities(s) {
  return (s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function stripCdata(s) {
  return (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(s) {
  return decodeEntities(stripCdata(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Inner text of the first <tag>…</tag> in the block (namespace-tolerant), or ''. */
function tagText(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  return m ? m[1].trim() : '';
}

/** Atom <link href="…"/> — prefer rel="alternate" (or no rel), fall back to any href. */
function atomLink(block) {
  const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const pick =
    links.find((l) => /rel=["']alternate["']/i.test(l)) ??
    links.find((l) => !/rel=/i.test(l)) ??
    links[0];
  const href = pick && /href=["']([^"']+)["']/i.exec(pick);
  return href ? decodeEntities(href[1]) : '';
}

/**
 * Parse an RSS 2.0 or Atom feed.
 * @returns {{ title: string, items: Array<{title,link,pubDate,contentSnippet}> }}
 */
export function parseFeed(xml) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const itemRe = isAtom ? /<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi : /<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi;

  const blocks = xml.match(itemRe) ?? [];
  const head = xml.slice(0, blocks.length ? xml.indexOf(blocks[0]) : xml.length);
  const feedTitle = stripHtml(tagText(head, 'title'));

  const items = blocks.map((block) => {
    const link = isAtom
      ? atomLink(block)
      : decodeEntities(stripCdata(tagText(block, 'link'))).trim();
    const pubDate =
      tagText(block, 'pubDate') || tagText(block, 'published') ||
      tagText(block, 'updated') || tagText(block, 'dc:date') || null;
    const snippet =
      tagText(block, 'description') || tagText(block, 'summary') ||
      tagText(block, 'content:encoded') || tagText(block, 'content') || '';
    return {
      title: stripHtml(tagText(block, 'title')),
      link,
      pubDate: pubDate ? stripHtml(pubDate) : null,
      contentSnippet: stripHtml(snippet).slice(0, 500),
    };
  });

  return { title: feedTitle, items };
}
