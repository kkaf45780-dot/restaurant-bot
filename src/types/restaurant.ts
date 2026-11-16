export type DayKey =
  | 'saturday'
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday';

export interface DaySchedule {
  day: DayKey;
  labelAr: string;
  isClosed: boolean;
  openTime: string; // HH:mm (24h)
  closeTime: string; // HH:mm (24h) - if <= openTime, extends past midnight
}

export interface ScheduleException {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  isClosed: boolean;
  openTime?: string;
  closeTime?: string;
}

export type ManualRestaurantStatus = 'auto' | 'force_open' | 'force_closed';

export interface MenuCategory {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  sortOrder: number;
}

export interface ProductSize {
  id: string;
  label: string;
  priceDelta: number; // Added on top of base item price (can be 0 for default)
  isDefault?: boolean;
}

export interface ProductExtra {
  id: string;
  label: string;
  price: number;
  isFree: boolean;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number; // Base price in EGP
  imageUrl: string;
  isAvailable: boolean;
  sortOrder: number;
  isPopular?: boolean;
  stockQuantity: number;
  lowStockThreshold: number;
  sizes: ProductSize[];
  extras: ProductExtra[];
}

export interface DeliveryZone {
  id: string;
  restaurantId: string;
  name: string;
  fee: number;
  minOrderAmount: number;
  estimatedMinutes: string;
  isActive: boolean;
}

export interface RestaurantBranch {
  id: string;
  restaurantId: string;
  name: string;
  address: string;
  phone: string;
  hoursText: string;
  isOpen: boolean;
}

export interface Coupon {
  id: string;
  restaurantId: string;
  code: string;
  description: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number;
  validFrom: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  usageLimit: number;
  usedCount: number;
  isActive: boolean;
  applicableCategoryIds?: string[];
  applicableItemIds?: string[];
}

export interface InventoryMovement {
  id: string;
  restaurantId: string;
  itemId: string;
  itemName: string;
  change: number;
  previousQty: number;
  newQty: number;
  reason: string;
  referenceOrderId?: string;
  createdAt: string;
}

export type EmployeeRole = 'owner' | 'manager' | 'cashier' | 'kitchen';

export interface Employee {
  id: string;
  restaurantId: string;
  name: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  isActive: boolean;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  restaurantId: string;
  actorName: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface AdminNotification {
  id: string;
  restaurantId: string;
  type: 'order' | 'stock' | 'system';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export type OrderStatus =
  | 'received'
  | 'under_review'
  | 'accepted'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export type FulfillmentType = 'delivery' | 'pickup';

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  timestamp: string;
  note?: string;
}

export interface OrderItem {
  lineKey?: string;
  itemId: string;
  name: string;
  unitPrice: number; // Effective unit price including size + extras
  quantity: number;
  lineTotal: number;
  selectedSizeId?: string;
  selectedSizeLabel?: string;
  sizePriceDelta?: number;
  selectedExtras?: Array<{ id: string; label: string; price: number }>;
  itemNotes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  restaurantId: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: FulfillmentType;
  deliveryZoneId: string;
  deliveryZoneName: string;
  branchId?: string;
  branchName?: string;
  customerAddress: string;
  notes: string;
  items: OrderItem[];
  subtotal: number;
  discountAmount: number;
  couponCode?: string;
  deliveryFee: number;
  total: number;
  paymentMethod: 'cash_on_delivery' | 'card_on_delivery';
  paymentStatus: 'pending' | 'paid';
  estimatedDeliveryText?: string;
  stockDeducted?: boolean;
  idempotencyKey?: string;
  status: OrderStatus;
  statusHistory: OrderStatusHistoryEntry[];
  rating?: number;
  ratingComment?: string;
  ratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AITone = 'friendly_egyptian' | 'concise_practical' | 'warm_detailed';

export interface AIAllowedTopics {
  menuAndPrices: boolean;
  workingHours: boolean;
  deliveryZones: boolean;
  orderIntake: boolean;
}

export const ALLOWED_AI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
] as const;

export type AIModelId = (typeof ALLOWED_AI_MODELS)[number];

export interface AISettings {
  enabled: boolean;
  model: AIModelId;
  welcomeMessage: string;
  tone: AITone;
  allowedTopics: AIAllowedTopics;
  customInstructions: string;
}

export interface SystemSettings {
  currencyLabel: string;
  currencyCode: string;
  timezone: string;
  supportEmail: string;
  requirePhoneVerificationNote: boolean;
  allowOrdersWhenClosed: boolean;
  taxPercent?: number;
}

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  description: string;
  address: string;
  phone: string;
  whatsappNumber: string; // International format without + e.g. 201012345678
  logoUrl: string;
  manualStatus: ManualRestaurantStatus;
  weeklySchedule: DaySchedule[];
  scheduleExceptions: ScheduleException[];
  aiSettings: AISettings;
  systemSettings: SystemSettings;
  updatedAt: string;
}

export interface RestaurantBundle {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
  deliveryZones: DeliveryZone[];
  branches: RestaurantBranch[];
  activeCoupons: Coupon[];
}

export interface AILogEntry {
  id: string;
  restaurantId: string;
  timestamp: string;
  model: string;
  status: 'success' | 'error' | 'fallback';
  latencyMs: number;
  userMessagePreview: string;
  errorMessage?: string;
}

export interface OrderDraftItem {
  lineKey?: string;
  itemId: string;
  quantity: number;
  selectedSizeId?: string;
  selectedExtraIds?: string[];
  itemNotes?: string;
}

export interface OrderDraft {
  items: OrderDraftItem[];
  fulfillmentType: FulfillmentType;
  deliveryZoneId: string;
  branchId?: string;
  couponCode?: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
}

export type SuggestedChatAction =
  | 'none'
  | 'show_menu'
  | 'show_whatsapp'
  | 'show_hours'
  | 'show_delivery'
  | 'show_order_summary';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestedAction?: SuggestedChatAction;
}

export interface ServiceConfigStatus {
  geminiConfigured: boolean;
  supabaseConfigured: boolean;
  storageMode: 'supabase' | 'local';
  authMode: 'supabase' | 'local';
  demoAdminEmail: string;
}
