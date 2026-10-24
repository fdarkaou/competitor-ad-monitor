#!/usr/bin/env node
// Competitor ad monitor on the PeekPanda API. Node 18+, no dependencies.
// Asks one question per run: which paid ads did PeekPanda find for these apps since I last looked?
import { readFile, writeFile, rename } from 'node:fs/promises';
import { collect, newestDiscoveredAt, toRow, toMarkdown, toCsv, toChat } from './monitor.js';

const HELP = `Usage:
  PEEKPANDA_TOKEN=... node cli.js <storeId> [storeId ...] [options]
  node cli.js --file page.json [--file page2.json ...] [options]

Options:
  --state <path>         file that remembers the newest discoveredAt (default .ad-monitor-state.json)
  --since <iso>          read ads found after this instant instead of the state file
  --no-state             do not read or write the state file
  --platform meta|tiktok only one ad platform
  --format md|csv|json   output format (default md)
  --max-pages <n>        stop after n pages of 40 ads (default 5)
  --webhook <url>        also POST a short summary to a Slack or Discord incoming webhook
  --tenancy <value>      x-genviral-tenancy header (default personal)
  --api <url>            API base (default https://api.peekpanda.com)
  --file <path>          read a saved GET /v1/paid-ads response instead of calling the API`;

function parse(argv) {
  const o = { state: '.ad-monitor-state.json', useState: true, format: 'md', maxPages: 5, tenancy: 'personal', api: 'https://api.peekpanda.com', files: [], ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--file') o.files.push(v());
    else if (a === '--no-state') o.useState = false;
    else if (a === '--max-pages') o.maxPages = Number(v());
    else if (a === '--webhook' || a === '--slack-webhook') o.webhook = v();
    else if (a.startsWith('--')) o[a.slice(2)] = v();
    else o.ids.push(...a.split(',').filter(Boolean));
  }
  return o;
}

async function readState(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return {}; }
}

async function fetchPages(o, since) {
  const token = process.env.PEEKPANDA_TOKEN;
  if (!token) throw new Error('Set PEEKPANDA_TOKEN to a PeekPanda API key (Account → API keys). Never commit it.');
  for (const id of o.ids) if (!/^\d+$/.test(id)) throw new Error(`storeId must be numeric, got "${id}"`);
  if (o.ids.length > 25) throw new Error('The API takes at most 25 storeIds per request.');
  const pages = [];
  let cursor = null;
  for (let n = 0; n < o.maxPages; n++) {
    const url = new URL('/v1/paid-ads', o.api);
    const q = { storeIds: o.ids.join(','), sort: 'recently_discovered', limit: '40' };
    if (since) q.discoveredAfter = since;
    if (o.platform) q.platform = o.platform;
    if (cursor) q.cursor = cursor;
    url.search = new URLSearchParams(q);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-genviral-tenancy': o.tenancy, Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const retry = res.headers.get('retry-after');
      throw new Error(`PeekPanda API ${res.status} ${body?.error?.code ?? ''}: ${body?.error?.message ?? res.statusText}${retry ? ` (retry after ${retry}s)` : ''}`);
    }
    const page = await res.json();
    pages.push(page);
    if (!page.hasMore || !page.nextCursor) return { pages, complete: true };
    cursor = page.nextCursor; // same filters and sort on every page, as the docs require
  }
  return { pages, complete: false };
}

async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help || (!o.ids.length && !o.files.length)) { console.log(HELP); return; }

  const key = [...o.ids].sort().join(',') + (o.platform ? `@${o.platform}` : '');
  const state = o.useState && o.ids.length ? await readState(o.state) : {};
  const since = o.since ?? state[key] ?? null;

  const pages = [];
  for (const f of o.files) pages.push(JSON.parse(await readFile(f, 'utf8')));
  let complete = true;
  if (o.ids.length) {
    const r = await fetchPages(o, since);
    pages.push(...r.pages);
    complete = r.complete;
  }

  let items = collect(pages);
  if (since) items = items.filter((it) => !it.discoveredAt || it.discoveredAt > since); // discoveredAfter is strict
  const rows = items.map((it) => toRow(it));

  if (o.format === 'json') console.log(JSON.stringify(rows, null, 2));
  else if (o.format === 'csv') console.log(toCsv(rows));
  else console.log(toMarkdown(rows, { since }));
  if (!complete) console.error(`Stopped after ${o.maxPages} pages; state file not advanced. Raise --max-pages to read everything.`);

  if (o.webhook && rows.length) {
    const text = toChat(rows);
    const discord = /discord(app)?\.com\/api\/webhooks/.test(o.webhook);
    const res = await fetch(o.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(discord ? { content: text.slice(0, 1990) } : { text }) });
    if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
  }

  // Advance the stored timestamp only after everything above succeeded, so a failed run is read again.
  // When paging stopped early, items are newest-first, so only an ascending re-read would be safe: keep the old value.
  if (o.useState && o.ids.length && !o.since && complete) {
    const next = newestDiscoveredAt(items, since);
    if (next && next !== since) {
      state[key] = next;
      await writeFile(`${o.state}.tmp`, JSON.stringify(state, null, 2) + '\n');
      await rename(`${o.state}.tmp`, o.state);
    }
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
