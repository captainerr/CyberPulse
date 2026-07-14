import type { NewsLinkItem } from '../models/kev';

const API_BASE = '/api';

function parseLinks(data: { links?: unknown }): NewsLinkItem[] {
  const links = Array.isArray(data.links) ? data.links : [];
  return links.slice(0, 3).map((item: { title?: string; url?: string }) => ({
    title: typeof item.title === 'string' ? item.title : item.url || 'Link',
    url: typeof item.url === 'string' ? item.url : '',
  }));
}

export async function fetchNewsLinks(cveId: string): Promise<NewsLinkItem[]> {
  const qs = new URLSearchParams({ cveId });
  const res = await fetch(`${API_BASE}/links?${qs}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return parseLinks(await res.json());
}

export async function fetchSearchLinks(query: string, excludeDomain?: string): Promise<NewsLinkItem[]> {
  const qs = new URLSearchParams({ q: query });
  if (excludeDomain) qs.set('excludeDomain', excludeDomain);
  const res = await fetch(`${API_BASE}/links?${qs}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return parseLinks(await res.json());
}
