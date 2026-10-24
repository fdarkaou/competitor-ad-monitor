// Pure helpers for the competitor ad monitor. No I/O, no dependencies.

const DAY = 86400000;

/** Collect items from one or more GET /v1/paid-ads pages, drop duplicates, newest discoveredAt first. */
export function collect(pages) {
  const seen = new Map();
  for (const p of pages) for (const it of p?.items ?? []) {
    const key = it.canonicalKey ?? `paid:${it.platform}:${it.archiveId}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  return [...seen.values()].sort((a, b) => String(b.discoveredAt).localeCompare(String(a.discoveredAt)));
}

/** Newest discoveredAt among the items, or the previous value when nothing new came back. */
export function newestDiscoveredAt(items, previous = null) {
  let best = previous;
  for (const it of items) if (it.discoveredAt && (!best || it.discoveredAt > best)) best = it.discoveredAt;
  return best;
}

/** Days an ad has run: live ads count to `now`, stopped ads to their disclosed end. null when no start date. */
export function runDays(it, now = new Date()) {
  if (!it.startedAt) return null;
  const end = it.endedAt ? new Date(it.endedAt) : now;
  return Math.max(0, Math.floor((end - new Date(it.startedAt)) / DAY));
}

const clean = (s, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** One flat row per ad. */
export function toRow(it, now = new Date()) {
  return {
    advertiser: it.advertiser?.name ?? 'unknown advertiser',
    app: it.productLink?.name ?? it.creative?.title ?? '',
    appStoreId: it.destination?.appStoreId ?? it.productLink?.externalId ?? '',
    platform: it.platform ?? '',
    format: it.creative?.format ?? 'unknown',
    status: it.status ?? 'unknown',
    hook: clean(it.creative?.hook ?? it.creative?.body),
    cta: it.creative?.ctaText ?? '',
    startedAt: it.startedAt ? it.startedAt.slice(0, 10) : '',
    discoveredAt: it.discoveredAt ?? '',
    runDays: runDays(it, now),
    reach: it.performance?.kind === 'reported_reach' ? 'reported' : '',
    url: it.sourceUrl ?? '',
  };
}

/** Counts per advertiser and per format. */
export function summary(rows) {
  const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
  return { total: rows.length, advertisers: by('advertiser'), formats: by('format'), platforms: by('platform') };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');

export function toMarkdown(rows, { since = null } = {}) {
  const head = since ? `New paid ads found since ${since}` : 'Paid ads found (first run, no previous timestamp)';
  if (!rows.length) return `${head}: none.\n\nNo new stored observation. That does not prove the apps stopped advertising.`;
  const s = summary(rows);
  const top = Object.entries(s.advertisers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  const fmts = Object.entries(s.formats).map(([k, v]) => `${k} ${v}`).join(', ');
  const lines = [
    `${head}: ${s.total}`,
    '',
    `By advertiser: ${top}  `,
    `By format: ${fmts}`,
    '',
    '| Advertiser | Platform | Format | Status | Hook | Started | Run days | Found | Ad |',
    '| --- | --- | --- | --- | --- | --- | ---: | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(`| ${esc(r.advertiser)} | ${r.platform} | ${r.format} | ${r.status} | ${esc(r.hook) || '–'} | ${r.startedAt || '–'} | ${r.runDays ?? '–'} | ${r.discoveredAt.slice(0, 10)} | ${r.url ? `[open](${r.url})` : '–'} |`);
  }
  return lines.join('\n');
}

export function toCsv(rows) {
  const cols = ['advertiser', 'app', 'appStoreId', 'platform', 'format', 'status', 'hook', 'cta', 'startedAt', 'discoveredAt', 'runDays', 'reach', 'url'];
  const q = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
}

/** Short plain-text message for a Slack or Discord webhook. */
export function toChat(rows, { max = 10 } = {}) {
  if (!rows.length) return '';
  const s = summary(rows);
  const head = `${s.total} new competitor ad${s.total === 1 ? '' : 's'}: ` +
    Object.entries(s.advertisers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ');
  const body = rows.slice(0, max).map((r) => `• ${r.advertiser} · ${r.platform} ${r.format}${r.hook ? ` · "${r.hook}"` : ''}${r.url ? ` ${r.url}` : ''}`);
  if (rows.length > max) body.push(`…and ${rows.length - max} more`);
  return [head, ...body].join('\n');
}
