import axios from 'axios';
import RSSParser from 'rss-parser';
import { Tweet } from './types';
import { config } from './config';

const rssParser = new RSSParser();

export function getSourceEmoji(source: Tweet['source']): string {
  switch (source) {
    case 'syndication': return '⚡';
    case 'twitter-api': return '🔑';
    case 'nitter': return '📡';
  }
}

// ─── Layer 1: Twitter Syndication API ────────────────────────────────────────

async function fetchViaSyndication(handle: string): Promise<Tweet[]> {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}?count=20`;

  const response = await axios.get(url, {
    timeout: config.requestTimeoutMs,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://twitter.com',
    },
  });

  const instructions: unknown[] =
    response.data?.data?.timeline_response?.timeline?.instructions ?? [];

  const addEntriesInstruction = (instructions as Array<{ type?: string; entries?: unknown[] }>)
    .find((i) => i.type === 'TimelineAddEntries');

  const entries: unknown[] = addEntriesInstruction?.entries ?? [];

  const tweets: Tweet[] = [];

  for (const entry of entries as Array<Record<string, unknown>>) {
    const itemContent = (entry as { content?: { itemContent?: Record<string, unknown> } })
      ?.content?.itemContent;
    if (!itemContent || itemContent['__typename'] !== 'TimelineTweet') continue;

    const tweetResult = (itemContent as { tweet_results?: { result?: { legacy?: Record<string, unknown> } } })
      ?.tweet_results?.result?.legacy;
    if (!tweetResult) continue;

    const idStr = tweetResult['id_str'] as string | undefined;
    const fullText = tweetResult['full_text'] as string | undefined;
    const createdAt = tweetResult['created_at'] as string | undefined;
    const inReplyToScreenName = tweetResult['in_reply_to_screen_name'] as string | null | undefined;

    if (!idStr || !fullText) continue;

    tweets.push({
      id: idStr,
      handle,
      text: fullText,
      url: `https://x.com/${handle}/status/${idStr}`,
      publishedAt: createdAt ? new Date(createdAt).toISOString() : new Date().toISOString(),
      isRetweet: fullText.startsWith('RT @'),
      isReply: !!inReplyToScreenName,
      source: 'syndication',
    });
  }

  return tweets;
}

// ─── Layer 2: Twitter API v2 ──────────────────────────────────────────────────

interface TwitterV2Tweet {
  id: string;
  text: string;
  created_at?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
}

async function fetchViaTwitterAPI(handle: string): Promise<Tweet[]> {
  const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
    timeout: config.requestTimeoutMs,
    headers: {
      Authorization: `Bearer ${config.twitterBearerToken}`,
    },
    params: {
      query: `from:${handle}`,
      max_results: 10,
      'tweet.fields': 'created_at,text,referenced_tweets,in_reply_to_user_id',
      expansions: 'author_id',
    },
  });

  const data: TwitterV2Tweet[] = response.data?.data ?? [];

  return data.map((t) => ({
    id: t.id,
    handle,
    text: t.text,
    url: `https://x.com/${handle}/status/${t.id}`,
    publishedAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
    isRetweet: (t.referenced_tweets ?? []).some((r) => r.type === 'retweeted'),
    isReply: !!t.in_reply_to_user_id,
    source: 'twitter-api',
  }));
}

// ─── Layer 3: Nitter RSS ──────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .trim();
}

function nitterUrlToX(nitterUrl: string): string {
  try {
    const parsed = new URL(nitterUrl);
    const cleanPath = parsed.pathname.replace(/#m$/, '');
    return `https://x.com${cleanPath}`;
  } catch {
    return nitterUrl;
  }
}

async function fetchViaNitter(handle: string): Promise<Tweet[]> {
  let lastError: Error = new Error('No nitter instances available');

  for (const instance of config.nitterInstances) {
    try {
      const feedUrl = `${instance}/${handle}/rss`;
      const feed = await rssParser.parseURL(feedUrl);

      const tweets: Tweet[] = [];

      for (const item of feed.items) {
        const rawUrl = item.link ?? '';
        const match = rawUrl.match(/\/status\/(\d+)/);
        if (!match) continue;

        const id = match[1];
        const url = nitterUrlToX(rawUrl);
        const title = item.title ?? '';
        const content = item['content:encoded'] ?? item.content ?? item.contentSnippet ?? '';

        tweets.push({
          id,
          handle,
          text: stripHtml(content) || title,
          url,
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          isRetweet: title.startsWith('RT by'),
          isReply: title.startsWith('R to'),
          source: 'nitter',
        });
      }

      return tweets;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[fetcher] Nitter instance ${instance} failed for @${handle}: ${msg}`);
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function fetchLatestTweets(handle: string): Promise<Tweet[]> {
  // Layer 1: Syndication
  try {
    const tweets = await fetchViaSyndication(handle);
    return tweets;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[fetcher] Layer 1 failed for @${handle}: ${msg}`);
  }

  // Layer 2: Twitter API v2 (only if bearer token is configured)
  if (config.twitterBearerToken) {
    try {
      const tweets = await fetchViaTwitterAPI(handle);
      return tweets;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[fetcher] Layer 2 failed for @${handle}: ${msg}`);
    }
  }

  // Layer 3: Nitter RSS
  return fetchViaNitter(handle);
}
