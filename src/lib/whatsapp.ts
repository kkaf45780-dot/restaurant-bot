import type { Order } from '../types/restaurant.ts';
import { formatCurrency } from './pricing.ts';

export function sanitizeWhatsappNumber(rawPhone: string): string {
  const digits = (rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('01') && digits.length === 11) {
    return `2${digits}`;
  }
  return digits;
}

export function buildWhatsAppOrderMessage(
  order: Order,
  restaurantName: string,
  currencyLabel = 'ج.م'
): string {
  const fulfillmentLabel =
    order.fulfillmentType === 'pickup' ? 'استلام من الفرع' : 'توصيل للمنزل';

  const lines: string[] = [
    `طلب جديد - ${restaurantName}`,
    `رقم الطلب: #${order.orderNumber}`,
    `نوع الطلب: ${fulfillmentLabel}`,
    '━━━━━━━━━━━━━━',
    `الاسم: ${order.customerName}`,
    `رقم الهاتف: ${order.customerPhone}`,
  ];

  if (order.fulfillmentType === 'pickup') {
    lines.push(`فرع الاستلام: ${order.branchName || 'الفرع الرئيسي'}`);
  } else {
    lines.push(`منطقة التوصيل: ${order.deliveryZoneName}`);
    lines.push(`العنوان: ${order.customerAddress}`);
  }

  if (order.notes && order.notes.trim()) {
    lines.push(`ملاحظات: ${order.notes.trim()}`);
  }

  lines.push('━━━━━━━━━━━━━━', 'الأصناف المطلوبة:');

  for (const item of order.items) {
    const sizeText = item.selectedSizeLabel ? ` (${item.selectedSizeLabel})` : '';
    lines.push(
      `• ${item.quantity} × ${item.name}${sizeText} (${formatCurrency(item.unitPrice, currencyLabel)}) = ${formatCurrency(item.lineTotal, currencyLabel)}`
    );
    if (item.selectedExtras && item.selectedExtras.length > 0) {
      const extrasNames = item.selectedExtras
        .map((e) => (e.price > 0 ? `${e.label} (+${e.price})` : e.label))
        .join('، ');
      lines.push(`   ↳ إضافات: ${extrasNames}`);
    }
    if (item.itemNotes) {
      lines.push(`   ↳ ملاحظة: ${item.itemNotes}`);
    }
  }

  lines.push(
    '━━━━━━━━━━━━━━',
    `إجمالي المنتجات: ${formatCurrency(order.subtotal, currencyLabel)}`
  );

  if (order.discountAmount > 0) {
    lines.push(
      `الخصم${order.couponCode ? ` (${order.couponCode})` : ''}: -${formatCurrency(order.discountAmount, currencyLabel)}`
    );
  }

  if (order.fulfillmentType === 'delivery') {
    lines.push(
      `رسوم التوصيل (${order.deliveryZoneName}): ${formatCurrency(order.deliveryFee, currencyLabel)}`
    );
  }

  lines.push(
    `الإجمالي النهائي: ${formatCurrency(order.total, currencyLabel)}`,
    '━━━━━━━━━━━━━━',
    'بانتظار تأكيد المطعم لاستلام الطلب.'
  );

  return lines.join('\n');
}

export function buildWhatsAppOrderUrl(
  whatsappNumber: string,
  order: Order,
  restaurantName: string,
  currencyLabel = 'ج.م'
): string | null {
  const cleanNumber = sanitizeWhatsappNumber(whatsappNumber);
  if (!cleanNumber) return null;
  const message = buildWhatsAppOrderMessage(order, restaurantName, currencyLabel);
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppInquiryUrl(whatsappNumber: string, text: string): string | null {
  const cleanNumber = sanitizeWhatsappNumber(whatsappNumber);
  if (!cleanNumber) return null;
  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}
