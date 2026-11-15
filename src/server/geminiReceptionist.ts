import type { OrderDraft, RestaurantBundle } from '../types/restaurant.ts';
import {
  type ChatHistoryTurn,
  type ReceptionistChatResult,
  runReceptionistChatCore,
} from './geminiCore.ts';
import { appendAiLog } from './store.ts';

export type { ReceptionistChatResult };

export async function runReceptionistChat(params: {
  bundle: RestaurantBundle;
  userMessage: string;
  history: ChatHistoryTurn[];
  currentDraft: OrderDraft;
}): Promise<ReceptionistChatResult> {
  return runReceptionistChatCore({
    ...params,
    apiKey: process.env.GEMINI_API_KEY,
    onAiLog: appendAiLog,
  });
}
