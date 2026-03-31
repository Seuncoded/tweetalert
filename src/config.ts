import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const config = {
  telegramToken: requireEnv('TELEGRAM_BOT_TOKEN'),

  defaultChatId: process.env.DEFAULT_CHAT_ID
    ? parseInt(process.env.DEFAULT_CHAT_ID, 10)
    : null,

  twitterBearerToken: process.env.TWITTER_BEARER_TOKEN || null,

  pollIntervalMs: process.env.POLL_INTERVAL_MS
    ? parseInt(process.env.POLL_INTERVAL_MS, 10)
    : 120000,

  seenTweetWindow: 30,

  alertOnRetweets: process.env.ALERT_ON_RETWEETS !== 'false',

  alertOnReplies: process.env.ALERT_ON_REPLIES !== 'false',

  dataFile: process.env.DATA_FILE || './data/state.json',

  requestTimeoutMs: 10000,

  nitterInstances: [
    'https://nitter.poast.org',
    'https://nitter.privacydev.net',
    'https://nitter.net',
    'https://nitter.cz',
  ],
};
