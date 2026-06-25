# API Marketing Spend KPIs Design

## Goal

Add API-backed marketing spend to the sales dashboard without using fixed manual cost assumptions. The first implemented source is Amazon Ads, because Amazon advertising spend is available through the Amazon Ads reporting API and should feed MER / blended ROAS separately from Amazon marketplace fees.

## Scope

In scope:
- Store daily/campaign marketing spend from API sources.
- Ingest Amazon Ads spend through a n8n-facing endpoint.
- Aggregate total ad spend, ad spend rate, MER / blended ROAS, and net after API fees plus ads.
- Show the new KPIs in the existing sales dashboard next to the channel mix and fee metrics.
- Generate n8n workflow drafts for Amazon Ads sync and backfill.

Out of scope:
- Manual fixed COGS, M&D, TIPSA, gift, or logistics rules.
- Meta Ads and TikTok Ads integrations.
- Shopify/TIPSA real shipping costs unless a logistics API or invoice source is connected later.
- COGS by SKU until order line/SKU cost ingestion is added.

## Architecture

Create a new `PlatformMarketingSpend` table instead of overloading `PlatformFinancialTransaction`. Fees and payment/platform deductions remain in financial transactions; advertising spend lives in marketing spend. The sales API reads orders, financial transactions, and marketing spend for the selected period and computes API-visible contribution metrics.

Amazon Ads data arrives from n8n through `/api/n8n/marketing-spend`. A generated n8n workflow uses the Amazon Ads API reporting pattern: create a Sponsored Products campaign report, poll until complete, download the report document, normalize daily campaign rows, and post them to Review Admin.

## Data Flow

1. Amazon Ads API report returns daily campaign metrics such as `cost`, `sales1d`, `purchases1d`, `impressions`, and `clicks`.
2. n8n maps each row to one marketing spend record keyed by provider/report type/date/campaign.
3. Review Admin upserts spend records by provider and external record id.
4. `/api/sales` aggregates spend by platform for the active period.
5. The UI shows:
   - Total ad spend
   - MER / blended ROAS = net revenue / ad spend
   - Net API after fees and ads = net revenue - API fees - ad spend
   - Per-channel ad spend and MER where spend exists

## Error Handling

The ingest endpoint validates required money, date, provider, platform, and record id fields. The n8n workflow records sync failures in `PlatformSyncState` under `amazon_ads` or `amazon_ads_backfill_2026`. Missing Ads credentials should fail clearly at workflow runtime without affecting Shopify/Amazon order syncs.

## Testing

Add unit coverage for:
- Marketing spend schema normalization.
- Empty and valid spend batches.
- Sales aggregation with fees plus ad spend.
- MER behavior when ad spend is zero.

