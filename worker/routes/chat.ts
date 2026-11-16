import { runReceptionistChatCore } from '../../src/server/geminiCore.ts';
import type { AILogEntry, FulfillmentType, OrderDraft, OrderDraftItem, RestaurantBundle } from '../../src/types/restaurant.ts';
import type { KVNamespaceLike } from '../../src/server/edgeStore.ts';
import { checkChatRateAndCaptcha } from '../middleware/rate-limit.ts';

export interface ChatRouteInput {
  kv?: KVNamespaceLike;
  ip: string;
  captchaToken?: string;
  turnstileSecretKey?: string;
  geminiApiKey?: string;
  message?: unknown;
  history?: unknown;
  orderDraft?: Partial<OrderDraft>;
  loadBundle: () => Promise<RestaurantBundle>;
  onAiLog?: (entry: AILogEntry) => Promise<void>;
}

const MAX_MESSAGE_LENGTH = 1000;

export async function handlePublicChat(input: ChatRouteInput): Promise<Response> {
  const rateCheck = await checkChatRateAndCaptcha({
    kv: input.kv,
    ip: input.ip,
    captchaToken: input.captchaToken,
    turnstileSecretKey: input.turnstileSecretKey,
  });

  if (!rateCheck.allowed) {
    return rateCheck.response;
  }

  if (typeof input.message !== 'string' || !input.message.trim()) {
    return Response.json({ error: 'يُرجى كتابة رسالة قبل الإرسال.' }, { status: 400 });
  }

  const cleanMessage = input.message.trim();
  if (cleanMessage.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { error: `الرسالة طويلة جداً. الحد الأقصى ${MAX_MESSAGE_LENGTH} حرف.` },
      { status: 400 }
    );
  }

  const safeHistory = Array.isArray(input.history)
    ? input.history
        .slice(-10)
        .filter(
          (turn): turn is { role: 'user' | 'assistant'; text: string } =>
            Boolean(
              turn &&
                typeof turn === 'object' &&
                ((turn as { role?: unknown }).role === 'user' ||
                  (turn as { role?: unknown }).role === 'assistant') &&
                typeof (turn as { text?: unknown }).text === 'string'
            )
        )
        .map((turn) => ({
          role: turn.role,
          text: turn.text.slice(0, MAX_MESSAGE_LENGTH),
        }))
    : [];

  const draft = input.orderDraft ?? {};
  const safeDraft: OrderDraft = {
    items: Array.isArray(draft.items) ? (draft.items as OrderDraftItem[]) : [],
    fulfillmentType: (draft.fulfillmentType === 'pickup' ? 'pickup' : 'delivery') as FulfillmentType,
    deliveryZoneId: typeof draft.deliveryZoneId === 'string' ? draft.deliveryZoneId : '',
    branchId: typeof draft.branchId === 'string' ? draft.branchId : undefined,
    couponCode: typeof draft.couponCode === 'string' ? draft.couponCode : undefined,
    customerName: typeof draft.customerName === 'string' ? draft.customerName : '',
    customerPhone: typeof draft.customerPhone === 'string' ? draft.customerPhone : '',
    customerAddress: typeof draft.customerAddress === 'string' ? draft.customerAddress : '',
    notes: typeof draft.notes === 'string' ? draft.notes : '',
  };

  const bundle = await input.loadBundle();
  const result = await runReceptionistChatCore({
    bundle,
    userMessage: cleanMessage,
    history: safeHistory,
    currentDraft: safeDraft,
    apiKey: input.geminiApiKey,
    onAiLog: input.onAiLog,
  });

  return Response.json(result);
}
