import fs from 'fs';
import path from 'path';
import { BotState } from './types';
import { config } from './config';

const defaultState: BotState = {
  handles: [],
  subscribedChats: [],
  seenTweetIds: {},
};

export function loadState(): BotState {
  try {
    const raw = fs.readFileSync(config.dataFile, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BotState>;
    return {
      handles: parsed.handles ?? [],
      subscribedChats: parsed.subscribedChats ?? [],
      seenTweetIds: parsed.seenTweetIds ?? {},
    };
  } catch {
    return { ...defaultState, seenTweetIds: {} };
  }
}

export function saveState(state: BotState): void {
  const dir = path.dirname(config.dataFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.dataFile, JSON.stringify(state, null, 2), 'utf-8');
}
