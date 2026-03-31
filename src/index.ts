import http from 'http';
import path from 'path';
import { config } from './config';
import { loadState, saveState } from './storage';
import { createBot, sendTweetAlert } from './bot';
import { fetchLatestTweets } from './fetcher';

// Resolve data directory relative to this file so it works on Railway's filesystem
process.env.DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'state.json');

async function main(): Promise<void> {
  // 1. Load persisted state
  const state = loadState();

  // 2. Auto-subscribe defaultChatId if configured
  if (config.defaultChatId !== null && !state.subscribedChats.includes(config.defaultChatId)) {
    state.subscribedChats.push(config.defaultChatId);
    saveState(state);
  }

  // 3. Create bot
  const bot = createBot(state, () => saveState(state));

  // 4. Log startup info
  const layers: string[] = ['Syndication (Layer 1)'];
  if (config.twitterBearerToken) layers.push('Twitter API v2 (Layer 2)');
  layers.push('Nitter RSS (Layer 3 fallback)');

  console.log('🚀 X Tweet Alerter started');
  console.log(`📋 Monitored handles: ${state.handles.length}`);
  console.log(`💬 Subscribed chats: ${state.subscribedChats.length}`);
  console.log(`⏱  Poll interval: ${config.pollIntervalMs / 1000}s`);
  console.log(`🔌 Active layers: ${layers.join(' → ')}`);

  // ─── Poll function ────────────────────────────────────────────────────────

  async function pollAllHandles(): Promise<void> {
    if (state.handles.length === 0) return;

    console.log(`\n[poll] Checking ${state.handles.length} handle(s)...`);

    for (const entry of state.handles) {
      const { handle } = entry;

      try {
        const tweets = await fetchLatestTweets(handle);
        entry.consecutiveFailures = 0;
        entry.lastChecked = new Date().toISOString();

        // First run — seed seen IDs without alerting
        if (!state.seenTweetIds[handle]) {
          const seedIds = tweets.slice(0, config.seenTweetWindow).map((t) => t.id);
          state.seenTweetIds[handle] = seedIds;
          entry.lastTweetId = seedIds[0] ?? null;
          saveState(state);
          console.log(`[poll] Seeded @${handle} with ${seedIds.length} tweet ID(s) — no alerts sent`);
          await delay(2500);
          continue;
        }

        const seen = new Set(state.seenTweetIds[handle]);
        const newTweets = tweets.filter((t) => !seen.has(t.id));

        // Process in chronological order (oldest first)
        for (const tweet of newTweets.reverse()) {
          if (tweet.isRetweet && !config.alertOnRetweets) continue;
          if (tweet.isReply && !config.alertOnReplies) continue;
          await sendTweetAlert(bot, state, tweet);
        }

        // Prepend new IDs and trim window
        const newIds = newTweets.map((t) => t.id);
        state.seenTweetIds[handle] = [
          ...newIds,
          ...state.seenTweetIds[handle],
        ].slice(0, config.seenTweetWindow);

        if (newIds.length > 0) {
          entry.lastTweetId = newIds[0];
          console.log(`[poll] @${handle}: ${newIds.length} new tweet(s) found`);
        }

        saveState(state);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        entry.consecutiveFailures += 1;
        entry.lastChecked = new Date().toISOString();
        console.error(`[poll] Failed to fetch @${handle} (failure #${entry.consecutiveFailures}): ${msg}`);

        if (entry.consecutiveFailures >= 5) {
          const warning = `⚠️ Unable to fetch tweets for @${handle} — ${entry.consecutiveFailures} consecutive failures. Check the handle or try again later.`;
          for (const chatId of state.subscribedChats) {
            try {
              await bot.sendMessage(chatId, warning);
            } catch {
              // silently ignore per-chat errors
            }
          }
        }

        saveState(state);
      }

      await delay(2500);
    }
  }

  // ─── Start polling ────────────────────────────────────────────────────────

  await pollAllHandles();
  setInterval(() => {
    pollAllHandles().catch((err) => {
      console.error('[poll] Unhandled error in pollAllHandles:', err);
    });
  }, config.pollIntervalMs);

  // ─── Graceful shutdown ────────────────────────────────────────────────────

  function shutdown(): void {
    console.log('\n🛑 Shutting down — saving state...');
    saveState(state);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ─── HTTP server (required by Railway to bind a port) ────────────────────

  const port = parseInt(process.env.PORT ?? '3000', 10);
  http
    .createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    })
    .listen(port, () => {
      console.log(`[http] Listening on port ${port}`);
    });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
