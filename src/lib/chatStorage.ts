import { sanitizePiiText } from './pii.ts';
import type { ChatMessage, OrderDraft } from '../types/restaurant.ts';

const CHAT_STORAGE_PREFIX = 'moazzaf_chat_history_v2_';
const LEGACY_CHAT_PREFIX = 'moazzaf_chat_history_v1_';
const CHAT_OPT_OUT_KEY = 'moazzaf_chat_storage_opt_out_v1';
const CHAT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_STORED_MESSAGES = 20;

interface StoredChatPayload {
  expiresAt: number;
  messages: ChatMessage[];
}

function getStorageSafe(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access errors
  }
  return null;
}

export function getChatOptOut(): boolean {
  const storage = getStorageSafe();
  if (!storage) return false;
  return storage.getItem(CHAT_OPT_OUT_KEY) === 'true';
}

export function setChatOptOut(optOut: boolean, restaurantId?: string): void {
  const storage = getStorageSafe();
  if (!storage) return;
  storage.setItem(CHAT_OPT_OUT_KEY, optOut ? 'true' : 'false');
  if (optOut && restaurantId) {
    clearChatHistory(restaurantId);
  } else if (optOut) {
    // Purge all chat keys if no specific restaurantId passed
    const keysToDelete: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (
        k &&
        (k.startsWith(CHAT_STORAGE_PREFIX) ||
          k.startsWith(LEGACY_CHAT_PREFIX) ||
          k.startsWith('chat_rest_'))
      ) {
        keysToDelete.push(k);
      }
    }
    keysToDelete.forEach((k) => storage.removeItem(k));
  }
}

export function clearChatHistory(restaurantId: string): void {
  const storage = getStorageSafe();
  if (!storage) return;
  storage.removeItem(`${CHAT_STORAGE_PREFIX}${restaurantId}`);
  storage.removeItem(`${LEGACY_CHAT_PREFIX}${restaurantId}`);
  storage.removeItem(`chat_${restaurantId}`);
}

export function loadChatHistory(restaurantId: string): ChatMessage[] {
  const storage = getStorageSafe();
  if (!storage || getChatOptOut()) return [];

  // Clean up legacy v1 and chat_<id> keys unconditionally
  storage.removeItem(`${LEGACY_CHAT_PREFIX}${restaurantId}`);
  storage.removeItem(`chat_${restaurantId}`);

  const raw = storage.getItem(`${CHAT_STORAGE_PREFIX}${restaurantId}`);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as StoredChatPayload;
    if (!parsed || typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      clearChatHistory(restaurantId);
      return [];
    }
    if (!Array.isArray(parsed.messages)) return [];
    return parsed.messages.slice(-MAX_STORED_MESSAGES).map((m) => ({
      ...m,
      text: sanitizePiiText(m.text || ''),
    }));
  } catch {
    clearChatHistory(restaurantId);
    return [];
  }
}

export function saveChatHistory(restaurantId: string, messages: ChatMessage[]): void {
  const storage = getStorageSafe();
  if (!storage) return;

  if (getChatOptOut()) {
    clearChatHistory(restaurantId);
    return;
  }

  const sanitized: ChatMessage[] = messages
    .slice(-MAX_STORED_MESSAGES)
    .map((m) => ({
      id: m.id,
      role: m.role,
      text: sanitizePiiText(m.text),
      timestamp: m.timestamp,
      suggestedAction: m.suggestedAction,
    }));

  const payload: StoredChatPayload = {
    expiresAt: Date.now() + CHAT_TTL_MS,
    messages: sanitized,
  };

  try {
    storage.setItem(`${CHAT_STORAGE_PREFIX}${restaurantId}`, JSON.stringify(payload));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Strips customer PII fields before persisting OrderDraft to localStorage.
 */
export function sanitizeDraftForStorage(draft: OrderDraft): OrderDraft {
  return {
    items: Array.isArray(draft.items) ? draft.items : [],
    fulfillmentType: draft.fulfillmentType ?? 'delivery',
    deliveryZoneId: draft.deliveryZoneId ?? '',
    branchId: draft.branchId,
    couponCode: draft.couponCode,
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    notes: '',
  };
}
