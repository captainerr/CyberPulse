import React from 'react';
import { useSocialPulse } from '../hooks/useSocialPulse';

function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

function hostLabel(url: string | null): string {
  if (!url) return 'the fediverse';
  try { return new URL(url).hostname; } catch { return 'the fediverse'; }
}

export const SocialPulse: React.FC = () => {
  const { posts, source, loading, error } = useSocialPulse();

  return (
    <section className="overview-card social-card">
      <h2 className="overview-card-title">Community Pulse</h2>
      <p className="overview-card-sub">
        Live cybersecurity posts from the fediverse · {hostLabel(source)}
      </p>

      {loading ? (
        <div className="loading-state" aria-busy="true"><p>Loading feed…</p></div>
      ) : error ? (
        <p className="social-error">Feed unavailable: {error}</p>
      ) : posts.length === 0 ? (
        <p className="overview-card-sub">No recent posts.</p>
      ) : (
        <ul className="social-list">
          {posts.map((p) => (
            <li key={p.id} className="social-item">
              <div className="social-meta">
                <span className="social-author">{p.author}</span>
                {p.handle && <span className="social-handle">{p.handle}</span>}
                <span className="social-time">· {timeAgo(p.createdAt)}</span>
                <span className="social-tag">#{p.tag}</span>
              </div>
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="social-text">
                {p.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
