import TelegramBot from 'node-telegram-bot-api';
import { BotState, MonitoredHandle, Tweet } from './types';
import { config } from './config';
import { getSourceEmoji } from './fetcher';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

export function timeAgo(isoDate: string | null): string {
  if (!isoDate) return 'never';
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'just now';
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatWAT(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-NG', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoDate;
  }
}

// ─── Bot Factory ──────────────────────────────────────────────────────────────

export function createBot(state: BotState, onStateChange: () => void): TelegramBot {
  const bot = new TelegramBot(config.telegramToken, { polling: true });

  // /start
  bot.onText(/^\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!state.subscribedChats.includes(chatId)) {
      state.subscribedChats.push(chatId);
      onStateChange();
    }
    bot.sendMessage(
      chatId,
      `👋 *Welcome to X Tweet Alerter\\!*\n\nI monitor X \\(Twitter\\) handles and notify you when they post new tweets\\.\n\n*Commands:*\n/add @handle \\— Monitor a new handle\n/remove @handle \\— Stop monitoring a handle\n/list \\— Show all monitored handles\n/status \\— Show bot status\n/help \\— Show this help message`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  // /help
  bot.onText(/^\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `*X Tweet Alerter \\— Commands*\n\n/add @handle \\— Start monitoring a Twitter/X handle\n/remove @handle \\— Stop monitoring a handle\n/list \\— List all monitored handles and last check time\n/status \\— Show bot configuration and stats\n/help \\— Show this message`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  // /add @handle
  bot.onText(/^\/add\s+@?(\S+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const raw = match?.[1] ?? '';
    const handle = raw.toLowerCase().replace(/^@/, '');

    if (!/^[a-zA-Z0-9_]{1,50}$/.test(handle)) {
      bot.sendMessage(chatId, '❌ Invalid handle. Use only letters, numbers, and underscores (max 50 chars).');
      return;
    }

    if (state.handles.some((h) => h.handle === handle)) {
      bot.sendMessage(chatId, `⚠️ @${handle} is already being monitored.`);
      return;
    }

    const entry: MonitoredHandle = {
      handle,
      addedBy: chatId,
      addedAt: new Date().toISOString(),
      lastChecked: null,
      lastTweetId: null,
      consecutiveFailures: 0,
    };

    state.handles.push(entry);

    if (!state.subscribedChats.includes(chatId)) {
      state.subscribedChats.push(chatId);
    }

    onStateChange();
    bot.sendMessage(chatId, `✅ Now monitoring *@${escapeMarkdown(handle)}*\\. You'll be alerted when they tweet\\.`, {
      parse_mode: 'MarkdownV2',
    });
  });

  // /remove @handle
  bot.onText(/^\/remove\s+@?(\S+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const handle = (match?.[1] ?? '').toLowerCase().replace(/^@/, '');
    const index = state.handles.findIndex((h) => h.handle === handle);

    if (index === -1) {
      bot.sendMessage(chatId, `⚠️ @${handle} is not in the monitoring list.`);
      return;
    }

    state.handles.splice(index, 1);
    delete state.seenTweetIds[handle];
    onStateChange();
    bot.sendMessage(chatId, `🗑️ Removed *@${escapeMarkdown(handle)}* from monitoring\\.`, {
      parse_mode: 'MarkdownV2',
    });
  });

  // /list
  bot.onText(/^\/list/, (msg) => {
    const chatId = msg.chat.id;

    if (state.handles.length === 0) {
      bot.sendMessage(chatId, '📭 No handles being monitored. Use /add @handle to start.');
      return;
    }

    const lines = state.handles.map(
      (h) => `• @${escapeMarkdown(h.handle)} \\— last checked: ${escapeMarkdown(timeAgo(h.lastChecked))}`
    );
    bot.sendMessage(chatId, `*Monitored Handles \\(${state.handles.length}\\):*\n\n${lines.join('\n')}`, {
      parse_mode: 'MarkdownV2',
    });
  });

  // /status
  bot.onText(/^\/status/, (msg) => {
    const chatId = msg.chat.id;
    const intervalMins = (config.pollIntervalMs / 60000).toFixed(1);
    const hasBearer = config.twitterBearerToken ? 'Yes ✅' : 'No ❌';
    const retweets = config.alertOnRetweets ? 'On' : 'Off';
    const replies = config.alertOnReplies ? 'On' : 'Off';

    bot.sendMessage(
      chatId,
      `*Bot Status*\n\n` +
        `📋 Monitored handles: ${state.handles.length}\n` +
        `💬 Subscribed chats: ${state.subscribedChats.length}\n` +
        `⏱ Poll interval: ${escapeMarkdown(intervalMins)} minutes\n` +
        `🔁 Retweet alerts: ${retweets}\n` +
        `💬 Reply alerts: ${replies}\n` +
        `🔑 Twitter Bearer Token: ${hasBearer}`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  bot.on('polling_error', (err) => {
    console.error('[bot] Polling error:', err.message);
  });

  return bot;
}

// ─── Alert Sender ─────────────────────────────────────────────────────────────

export async function sendTweetAlert(
  bot: TelegramBot,
  state: BotState,
  tweet: Tweet
): Promise<void> {
  const tweetEmoji = tweet.isRetweet ? '🔁' : tweet.isReply ? '💬' : '🐦';
  const action = tweet.isRetweet ? 'Retweeted' : tweet.isReply ? 'Replied' : 'Tweeted';
  const sourceEmoji = getSourceEmoji(tweet.source);

  const header = `${tweetEmoji} *@${escapeMarkdown(tweet.handle)}* ${escapeMarkdown(action)} ${sourceEmoji}`;
  const body = escapeMarkdown(tweet.text);
  const timestamp = `🕐 ${escapeMarkdown(formatWAT(tweet.publishedAt))}`;
  const link = `[View on X](${tweet.url})`;

  const message = `${header}\n\n${body}\n\n${timestamp}\n${link}`;

  for (const chatId of state.subscribedChats) {
    try {
      await bot.sendMessage(chatId, message, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bot] Failed to send alert to chat ${chatId}: ${msg}`);
    }
  }
}
