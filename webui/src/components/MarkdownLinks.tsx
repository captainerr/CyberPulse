import React from 'react';
import { Link } from 'react-router-dom';
import { findAndReplace } from 'mdast-util-find-and-replace';

const CVE_PATTERN = /CVE-\d{4}-\d{4,}/g;

/**
 * Remark plugin: turn every "CVE-YYYY-NNNN" mention in prose into a link that
 * pivots straight into the enriched catalog record. The AI briefing/hunting
 * prompts deliberately cite exact CVE IDs, but they otherwise render as dead text
 * an analyst has to copy-paste into search — this closes that loop.
 *
 * `range=0` is included because the cited CVE can be arbitrarily old (nothing
 * ties briefing content to the catalog's default 30-day window), so the catalog
 * must fetch all-time or the target row would silently be missing (same reasoning
 * as the month/vendor/date-range deep links elsewhere in the app).
 *
 * findAndReplace only visits mdast `text` nodes, so it naturally leaves CVE
 * mentions inside fenced code blocks (Hunting page's KQL/XQL/SPL) untouched —
 * exactly what we want, since those must stay literal, runnable query text.
 */
export function remarkLinkCves() {
  return (tree: unknown) => {
    findAndReplace(tree as never, [
      [CVE_PATTERN, (match: string) => ({
        type: 'link',
        url: `/catalog?q=${match}&range=0`,
        children: [{ type: 'text', value: match }],
      })],
    ]);
  };
}

/**
 * `a` renderer for ReactMarkdown: internal links (from remarkLinkCves, or any
 * other `/...`-relative link the content might contain) become client-side
 * react-router navigation instead of a full page reload; everything else opens
 * in a new tab like a normal external link.
 */
export function MarkdownLink({ href, children }: React.ComponentPropsWithoutRef<'a'>) {
  if (href?.startsWith('/')) {
    return <Link to={href}>{children}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
