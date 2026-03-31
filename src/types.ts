export interface Tweet {
  id: string;
  handle: string;
  text: string;
  url: string;
  publishedAt: string; // ISO string
  isRetweet: boolean;
  isReply: boolean;
  source: 'syndication' | 'twitter-api' | 'nitter';
}

export interface MonitoredHandle {
  handle: string; // lowercase, no @
  addedBy: number; // chat ID
  addedAt: string; // ISO string
  lastChecked: string | null; // ISO string or null
  lastTweetId: string | null; // string or null
  consecutiveFailures: number;
}

export interface BotState {
  handles: MonitoredHandle[];
  subscribedChats: number[];
  seenTweetIds: Record<string, string[]>;
}
