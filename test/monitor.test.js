import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collect, newestDiscoveredAt, runDays, toRow, toMarkdown, toCsv, toChat, summary } from '../monitor.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url)));
const items = collect([load('page-1.json'), load('page-2.json')]);
const now = new Date('2026-10-24T00:00:00Z');

test('collect drops duplicates across pages and sorts newest first', () => {
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.archiveId), ['900000000000001', '900000000000002', '900000000000003']);
});

test('newest discoveredAt moves forward, never back', () => {
  assert.equal(newestDiscoveredAt(items), '2026-10-22T06:12:00.000Z');
  assert.equal(newestDiscoveredAt([], '2026-10-01T00:00:00.000Z'), '2026-10-01T00:00:00.000Z');
  assert.equal(newestDiscoveredAt(items, '2026-10-23T00:00:00.000Z'), '2026-10-23T00:00:00.000Z');
});

test('run days: live ads count to now, stopped ads to their end', () => {
  assert.equal(runDays(items[0], now), 14);
  assert.equal(runDays(items[2], now), 30);
  assert.equal(runDays({ startedAt: null }, now), null);
});

test('markdown, csv and chat output', () => {
  const rows = items.map((i) => toRow(i, now));
  assert.deepEqual(summary(rows).advertisers, { 'Example Meal Planner': 2, 'Example Calorie Counter': 1 });
  const md = toMarkdown(rows, { since: '2026-10-19T00:00:00Z' });
  assert.match(md, /since 2026-10-19T00:00:00Z: 3/);
  assert.match(md, /Plan a week of dinners \\\| in 5 minutes/); // pipes escaped
  assert.equal(toCsv(rows).split('\n').length, 4);
  assert.match(toChat(rows), /^3 new competitor ads: Example Meal Planner \(2\)/);
  assert.equal(toChat([]), '');
  assert.match(toMarkdown([]), /none/);
});
