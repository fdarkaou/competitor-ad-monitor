# competitor-ad-monitor

Find out when your App Store competitors start new Meta or TikTok ads. Give it the App Store ids of your rivals and each run prints only the ads found since the last run: advertiser, platform, format, hook, start date and how long the ad has run. It remembers where it stopped in a small state file, and it can post a short summary to Slack or Discord.

Node 18+, no dependencies. There is also a [browser version](https://fdarkaou.github.io/competitor-ad-monitor/) that works on pasted JSON and never sends it anywhere.

```
New paid ads found since 2026-10-19T00:00:00Z: 3

By advertiser: Example Meal Planner 2, Example Calorie Counter 1
By format: video 1, image 1, carousel 1

| Advertiser | Platform | Format | Status | Hook | Started | Run days | Found | Ad |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| Example Meal Planner | meta | video | active | Turn saved recipes into a grocery list | 2026-10-10 | 14 | 2026-10-22 | [open](https://www.facebook.com/ads/library?id=900000000000001) |
| Example Calorie Counter | tiktok | image | active | Snap your plate, see the calories | 2026-10-18 | 6 | 2026-10-21 | [open](https://library.tiktok.com/ads/detail/?ad_id=900000000000002) |
| Example Meal Planner | meta | carousel | inactive | Plan a week of dinners \| in 5 minutes | 2026-09-01 | 30 | 2026-10-20 | [open](https://www.facebook.com/ads/library?id=900000000000003) |
```

(Example data from `examples/`, not real apps or ads.)

## Where the data comes from

The ads come from [PeekPanda](https://peekpanda.com), which stores dated observations from the public Meta and TikTok ad libraries and links an ad to an App Store app when the ad's destination resolves to that app. The tool calls `GET /v1/paid-ads` with `storeIds`, `sort=recently_discovered` and `discoveredAfter`, and follows `nextCursor` until `hasMore` is false. Over MCP that is the `get_ads` tool with action `search`. This is the loop from the [scheduled competitor ads guide](https://peekpanda.com/docs/scheduled-competitor-ads). It only reads stored observations; it never asks PeekPanda to collect new ads.

You need a PeekPanda account and an API key. Every request counts toward your plan's daily API and MCP call allowance, so one run costs one call per page of 40 ads.

## Use it

```bash
git clone https://github.com/fdarkaou/competitor-ad-monitor && cd competitor-ad-monitor
export PEEKPANDA_TOKEN=...   # API key from Account → API keys. Keep it out of source control.

node cli.js 1000000001 1000000002                      # first run: recent ads, then remembers the newest one
node cli.js 1000000001 1000000002                      # next run: only ads found since then
node cli.js 1000000001 --platform tiktok --format csv > ads.csv
node cli.js 1000000001 --since 2026-10-20T00:00:00Z --no-state
node cli.js 1000000001 1000000002 --webhook "$SLACK_WEBHOOK_URL"   # Discord webhook URLs work too
```

Try it without an account on the bundled examples:

```bash
node cli.js --file examples/page-1.json --file examples/page-2.json
```

Options: `--state <path>`, `--since <iso>`, `--no-state`, `--platform meta|tiktok`, `--format md|csv|json`, `--max-pages <n>`, `--webhook <url>`, `--file <path>`, `--tenancy`, `--api`. Run `node cli.js --help` for details.

The state file (`.ad-monitor-state.json`) keeps one timestamp per set of store ids: the newest `discoveredAt` read so far. It is only written after the run, and the webhook, succeeded, so a failed run is simply read again next time. Up to 25 store ids per run, which is the API limit.

## How to read the output

- "Found" is when PeekPanda first recorded the ad. "Started" is when the advertiser started it, where the public record discloses that.
- Run days count a live ad up to today and a stopped ad up to its disclosed end. Long-running ads are the closest thing to a performance signal; no spend is published.
- "Status" is the observed status (active, inactive or unknown), not a live delivery check.
- No new ads does not prove a rival stopped advertising. It means no new stored observation.

## Daily digest in GitHub Actions

`.github/workflows/daily-ads.yml` is an example job that runs each weekday morning, writes the digest to the run summary and posts it to a webhook. It keeps the state file in the Actions cache between runs. Add `PEEKPANDA_TOKEN` and `AD_WEBHOOK_URL` as repository secrets, set the repository variable `ENABLE_AD_MONITOR` to `true`, and put your own store ids in the file.

## From an AI assistant (MCP)

If PeekPanda is connected in Claude Code, Codex or Cursor (`https://mcp.peekpanda.com/mcp`, see the [MCP docs](https://peekpanda.com/docs/mcp)), ask it to call `get_ads` with action `search`, save each page as a JSON file, then run `node cli.js --file page-1.json --file page-2.json --since <last timestamp>`. The request looks like:

```json
{ "name": "get_ads", "arguments": { "request": { "action": "search", "query": { "storeIds": "1000000001,1000000002", "sort": "recently_discovered", "discoveredAfter": "2026-10-20T00:00:00Z", "limit": 40 } } } }
```

## Tests

```bash
npm test
```

MIT license.
