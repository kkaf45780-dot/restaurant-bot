import type { OrderDraft } from '../types/restaurant.ts';

export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  suggestedAction?: string;
  timestamp: string;
}

interface StoredChatEnvelope {
  messages: StoredChatMessage[];
  savedAt: number;
  expiresAt: number;
}

interface StoredDraftEnvelope {
  draft: Partial<OrderDraft>;
  savedAt: number;
  expiresAt: number;
}

export const CHAT_TTL_MS = 24 * 60 * 60 * 1000;

export function getChatStorageKey(restaurantId: string): string {
  return `chat_${restaurantId}`;
}

export function getDraftStorageKey(restaurantId: string): string {
  return `draft_${restaurantId}`;
}

export function getChatOptOutKey(restaurantId: string): string {
  return `chat_no_save_${restaurantId}`;
}

export function stripPiiFromText(text: string): string {
  let clean = String(text || '');
  // Redact Egyptian mobile numbers & general 10+ digit phone sequences
  clean = clean.replace(/(?:\+?20|0)?1[0125]\s*[\d\s-]{8,11}/g, '[رقم محذوف]');
  clean = clean.replace(/\b\d{9,14}\b/g, '[رقم محذوف]');
  // Redact email addresses
  clean = clean.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[بريد محذوف]');
  // Redact street/building/floor/apartment address patterns in Arabic
  clean = clean.replace(
    /(?:شارع|ش\.|عمارة|برج|دور|شقة|بجوار|أمام)\s+[^\n،.]{3,50}/gi,
    '[عنوان محذوف]'
  );
  return clean;
}

export function sanitizeDraftForStorage(draft: OrderDraft): Partial<OrderDraft> {
  return {
    items: draft.items,
    fulfillmentType: draft.fulfillmentType,
    deliveryZoneId: draft.deliveryZoneId,
    branchId: draft.branchId,
    couponCode: draft.couponCode,
    // Intentionally omit customerName, customerPhone, customerAddress, notes to prevent PII in localStorage
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    notes: '',
  };
}

export function getChatOptOut(restaurantId: string): boolean {
  try {
    return localStorage.getItem(getChatOptOutKey(restaurantId)) === '1';
  } catch {
    return false;
  }
}

export function setChatOptOut(restaurantId: string, optOut: boolean): void {
  try {
    if (optOut) {
      localStorage.setItem(getChatOptOutKey(restaurantId), '1');
      localStorage.removeItem(getChatStorageKey(restaurantId));
      localStorage.removeItem(getDraftStorageKey(restaurantId));
    } else {
      localStorage.removeItem(getChatOptOutKey(restaurantId));
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function purgeExpiredChatStorage(restaurantId: string, now: number = Date.now()): void {
  try {
    const rawChat = localStorage.getItem(getChatStorageKey(restaurantId));
    if (rawChat) {
      const parsed = JSON.parse(rawChat) as Partial<StoredChatEnvelope> | unknown[];
      if (Array.isArray(parsed)) {
        // Legacy format without expiresAt -> remove to enforce TTL & PII clean slate
        localStorage.removeItem(getChatStorageKey(restaurantId));
      } else if (!parsed.expiresAt || parsed.expiresAt <= now) {
        localStorage.removeItem(getChatStorageKey(restaurantId));
      }
    }

    const rawDraft = localStorage.getItem(getDraftStorageKey(restaurantId));
    if (rawDraft) {
      const parsedDraft = JSON.parse(rawDraft) as Partial<StoredDraftEnvelope>;
      if (!parsedDraft.expiresAt || parsedDraft.expiresAt <= now) {
        localStorage.removeItem(getDraftStorageKey(restaurantId));
      }
    }
  } catch {
    try {
      localStorage.removeItem(getChatStorageKey(restaurantId));
      localStorage.removeItem(getDraftStorageKey(restaurantId));
    } catch {
      // Ignore
    }
  }
}

export function loadStoredChat(
  restaurantId: string,
  now: number = Date.now()
): StoredChatMessage[] | null {
  if (getChatOptOut(restaurantId)) return null;
  purgeExpiredChatStorage(restaurantId, now);
  try {
    const raw = localStorage.getItem(getChatStorageKey(restaurantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredChatEnvelope>;
    if (!Array.isArray(parsed.messages) || !parsed.expiresAt || parsed.expiresAt <= now) {
      localStorage.removeItem(getChatStorageKey(restaurantId));
      return null;
    }
    return parsed.messages.map((m) => ({
      ...m,
      text: stripPiiFromText(m.text),
    }));
  } catch {
    return null;
  }
}

export function saveStoredChat(
  restaurantId: string,
  messages: StoredChatMessage[],
  now: number = Date.now()
): void {
  if (getChatOptOut(restaurantId)) {
    try {
      localStorage.removeItem(getChatStorageKey(restaurantId));
    } catch {
      // Ignore
    }
    return;
  }
  try {
    const sanitizedMessages = messages.slice(-40).map((m) => ({
      id: m.id,
      role: m.role,
      text: stripPiiFromText(m.text),
      suggestedAction: m.suggestedAction,
      timestamp: m.timestamp,
    }));
    const envelope: StoredChatEnvelope = {
      messages: sanitizedMessages,
      savedAt: now,
      expiresAt: now + CHAT_TTL_MS,
    };
    localStorage.setItem(getChatStorageKey(restaurantId), JSON.stringify(envelope));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearStoredChat(restaurantId: string): void {
  try {
    localStorage.removeItem(getChatStorageKey(restaurantId));
  } catch {
    // Ignore
  }
}

export function loadStoredDraft(
  restaurantId: string,
  now: number = Date.now()
): Partial<OrderDraft> | null {
  if (getChatOptOut(restaurantId)) return null;
  purgeExpiredChatStorage(restaurantId, now);
  try {
    const raw = localStorage.getItem(getDraftStorageKey(restaurantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraftEnvelope>;
    if (!parsed.draft || !parsed.expiresAt || parsed.expiresAt <= now) {
      localStorage.removeItem(getDraftStorageKey(restaurantId));
      return null;
    }
    return parsed.draft;
  } catch {
    return null;
  }
}

export function saveStoredDraft(
  restaurantId: string,
  draft: OrderDraft,
  now: number = Date.now()
): void {
  if (getChatOptOut(restaurantId)) {
    try {
      localStorage.removeItem(getDraftStorageKey(restaurantId));
    } catch {
      // Ignore
    }
    return;
  }
  try {
    const envelope: StoredDraftEnvelope = {
      draft: sanitizeDraftForStorage(draft),
      savedAt: now,
      expiresAt: now + CHAT_TTL_MS,
    };
    localStorage.setItem(getDraftStorageKey(restaurantId), JSON.stringify(envelope));
  } catch {
    // Ignore storage errors
  }
}
