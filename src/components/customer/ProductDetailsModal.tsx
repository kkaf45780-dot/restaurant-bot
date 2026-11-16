import { Check, Minus, Plus, UtensilsCrossed, X } from 'lucide-react';
import { useState } from 'react';
import { resolveAssetUrl } from '../../lib/imageAssets.ts';
import { formatCurrency, fromPiasters, toPiasters } from '../../lib/pricing.ts';
import type { MenuItem, OrderDraftItem } from '../../types/restaurant.ts';

interface ProductDetailsModalProps {
  item: MenuItem;
  currencyLabel: string;
  editingLine?: OrderDraftItem | null;
  onClose: () => void;
  onAddConfiguredItem: (entry: OrderDraftItem) => void;
  onSaveEditedLine?: (previousLineKey: string, updatedEntry: OrderDraftItem) => void;
}

export function ProductDetailsModal({
  item,
  currencyLabel,
  editingLine,
  onClose,
  onAddConfiguredItem,
  onSaveEditedLine,
}: ProductDetailsModalProps) {
  const sizes = item.sizes ?? [];
  const extras = item.extras ?? [];
  const defaultSize = sizes.find((s) => s.isDefault) ?? sizes[0];

  const [selectedSizeId, setSelectedSizeId] = useState<string>(
    editingLine?.selectedSizeId ?? defaultSize?.id ?? ''
  );
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>(
    editingLine?.selectedExtraIds ?? []
  );
  const [itemNotes, setItemNotes] = useState(editingLine?.itemNotes ?? '');
  const [quantity, setQuantity] = useState(editingLine?.quantity ?? 1);
  const [imgBroken, setImgBroken] = useState(false);

  const selectedSize = sizes.find((s) => s.id === selectedSizeId);
  const sizeDelta = selectedSize ? selectedSize.priceDelta : 0;

  const extrasSumPiasters = extras
    .filter((ex) => selectedExtraIds.includes(ex.id) && !ex.isFree)
    .reduce((acc, ex) => acc + toPiasters(ex.price), 0);

  const unitPiasters = Math.max(
    0,
    toPiasters(item.price) + toPiasters(sizeDelta) + extrasSumPiasters
  );
  const totalPrice = fromPiasters(unitPiasters * quantity);

  const toggleExtra = (id: string) => {
    setSelectedExtraIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    const entry: OrderDraftItem = {
      itemId: item.id,
      quantity,
      selectedSizeId: selectedSize?.id,
      selectedExtraIds,
      itemNotes: itemNotes.trim() || undefined,
    };
    if (editingLine?.lineKey && onSaveEditedLine) {
      onSaveEditedLine(editingLine.lineKey, entry);
    } else {
      onAddConfiguredItem(entry);
    }
    onClose();
  };

  const imgSrc = resolveAssetUrl(item.imageUrl);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#14201B] rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-[#176B45]/15 dark:border-[#2A3F35]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Image Banner */}
        <div className="relative h-56 bg-[#F7F3E9] dark:bg-[#0E1713]">
          {imgSrc && !imgBroken ? (
            <img
              src={imgSrc}
              alt={item.name}
              onError={() => setImgBroken(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#176B45]/40">
              <UtensilsCrossed className="w-12 h-12" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="absolute top-3 left-3 w-10 h-10 rounded-full bg-white/95 dark:bg-[#14201B]/95 text-[#18221D] dark:text-white shadow-md flex items-center justify-center hover:bg-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <span
            className={`absolute bottom-3 right-3 px-3 py-1 rounded-full text-xs font-bold ${
              item.isAvailable && (typeof item.stockQuantity !== 'number' || item.stockQuantity > 0)
                ? 'bg-[#176B45] text-white'
                : 'bg-neutral-700 text-white'
            }`}
          >
            {item.isAvailable && (typeof item.stockQuantity !== 'number' || item.stockQuantity > 0)
              ? 'متوفر حالياً'
              : 'غير متوفر'}
          </span>
        </div>

        <div className="p-6 space-y-5">
          {/* Title & Description */}
          <div>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
                {item.name}
              </h2>
              <span className="text-lg font-extrabold text-[#176B45] dark:text-[#4ADE80] tabular-nums shrink-0">
                {formatCurrency(fromPiasters(unitPiasters), currencyLabel)}
              </span>
            </div>
            <p className="text-sm text-[#5C6B63] dark:text-[#A3B8AE] mt-1.5 leading-relaxed">
              {item.description}
            </p>
          </div>

          {/* Sizes Selection */}
          {sizes.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-sm font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
                اختر الحجم
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {sizes.map((sz) => {
                  const selected = sz.id === selectedSize?.id;
                  const sizePrice = fromPiasters(toPiasters(item.price) + toPiasters(sz.priceDelta));
                  return (
                    <button
                      key={sz.id}
                      type="button"
                      onClick={() => setSelectedSizeId(sz.id)}
                      className={`min-h-[46px] px-4 py-2.5 rounded-xl border text-sm font-bold flex items-center justify-between transition-colors cursor-pointer ${
                        selected
                          ? 'bg-[#176B45]/10 dark:bg-[#176B45]/30 border-[#176B45] text-[#104B34] dark:text-[#4ADE80]'
                          : 'bg-[#F7F3E9]/50 dark:bg-[#0E1713] border-[#176B45]/15 dark:border-[#2A3F35] text-[#2D3B34] dark:text-[#D1DFD8] hover:border-[#176B45]/40'
                      }`}
                    >
                      <span>{sz.label}</span>
                      <span className="text-xs font-extrabold tabular-nums">
                        {formatCurrency(sizePrice, currencyLabel)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Extras (Paid & Free) */}
          {extras.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-sm font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
                إضافات وخيارات خاصة
              </h3>
              <div className="space-y-2">
                {extras.map((ex) => {
                  const checked = selectedExtraIds.includes(ex.id);
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => toggleExtra(ex.id)}
                      className={`w-full min-h-[44px] px-4 py-2 rounded-xl border text-sm font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                        checked
                          ? 'bg-[#176B45]/10 dark:bg-[#176B45]/30 border-[#176B45] text-[#104B34] dark:text-[#4ADE80]'
                          : 'bg-white dark:bg-[#0E1713] border-[#176B45]/15 dark:border-[#2A3F35] text-[#2D3B34] dark:text-[#D1DFD8] hover:bg-[#F7F3E9]/60'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center border ${
                            checked
                              ? 'bg-[#176B45] border-[#176B45] text-white'
                              : 'border-[#176B45]/30 bg-white dark:bg-[#14201B]'
                          }`}
                        >
                          {checked && <Check className="w-3.5 h-3.5" />}
                        </span>
                        <span>{ex.label}</span>
                      </span>
                      <span className="text-xs font-bold tabular-nums text-[#176B45] dark:text-[#4ADE80]">
                        {ex.isFree ? 'مجاناً' : `+ ${formatCurrency(ex.price, currencyLabel)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Special Notes */}
          <div className="space-y-2">
            <label className="block text-sm font-extrabold text-[#18221D] dark:text-[#ECF3EF]">
              ملاحظات خاصة على الصنف (اختياري)
            </label>
            <input
              type="text"
              value={itemNotes}
              onChange={(e) => setItemNotes(e.target.value)}
              placeholder="مثال: تسوية كاملة، بدون بصل، شطة خفيفة..."
              className="w-full h-11 px-4 rounded-xl bg-[#F7F3E9]/60 dark:bg-[#0E1713] border border-[#176B45]/15 dark:border-[#2A3F35] text-sm text-[#18221D] dark:text-[#ECF3EF] focus:outline-none focus:ring-2 focus:ring-[#176B45]/25"
            />
          </div>

          {/* Quantity & Add/Save CTA */}
          <div className="pt-2 border-t border-[#176B45]/10 dark:border-[#2A3F35] flex items-center gap-3">
            <div className="flex items-center gap-1 bg-[#F7F3E9] dark:bg-[#0E1713] border border-[#176B45]/15 dark:border-[#2A3F35] rounded-xl p-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="تقليل الكمية"
                className="w-10 h-10 rounded-lg bg-white dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] flex items-center justify-center hover:bg-[#EFE9DC] cursor-pointer"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-8 text-center font-extrabold text-sm tabular-nums dark:text-[#ECF3EF]">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="زيادة الكمية"
                className="w-10 h-10 rounded-lg bg-white dark:bg-[#192822] text-[#104B34] dark:text-[#ECF3EF] flex items-center justify-center hover:bg-[#EFE9DC] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              disabled={!item.isAvailable || (typeof item.stockQuantity === 'number' && item.stockQuantity <= 0)}
              onClick={handleConfirm}
              className="flex-1 min-h-[48px] px-5 rounded-xl bg-[#104B34] hover:bg-[#176B45] disabled:opacity-50 text-white text-sm font-extrabold flex items-center justify-between cursor-pointer"
            >
              <span>{editingLine ? 'حفظ التعديلات' : 'إضافة إلى السلة'}</span>
              <span className="tabular-nums">{formatCurrency(totalPrice, currencyLabel)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

