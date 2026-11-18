import {
  ArrowDown,
  ArrowUp,
  Edit3,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PRESET_DISH_IMAGES } from '../../lib/imageAssets.ts';
import { formatCurrency } from '../../lib/pricing.ts';
import { SafeImage } from '../SafeImage.tsx';
import type {
  MenuCategory,
  MenuItem,
  ProductExtra,
  ProductSize,
  Restaurant,
} from '../../types/restaurant.ts';

interface MenuManagerProps {
  restaurant: Restaurant;
  categories: MenuCategory[];
  items: MenuItem[];
  onSaveCategory: (cat: Partial<MenuCategory> & { name: string }) => Promise<void>;
  onDeleteCategory: (catId: string) => Promise<void>;
  onSaveItem: (
    item: Partial<MenuItem> & { categoryId: string; name: string; price: number }
  ) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onReorderItems: (orderedIds: string[]) => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
}

export function MenuManager({
  restaurant,
  categories,
  items,
  onSaveCategory,
  onDeleteCategory,
  onSaveItem,
  onDeleteItem,
  onReorderItems,
  onUploadImage,
}: MenuManagerProps) {
  const currency = restaurant.systemSettings.currencyLabel;

  // Category Form State
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // Filters matching Menu_management_dashboard_layout
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCatId, setFilterCatId] = useState('all');
  const [filterAvail, setFilterAvail] = useState<'all' | 'available' | 'unavailable'>('all');

  // Product Editor Form matching Editing_food_product_form
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemPrice, setItemPrice] = useState('120');
  const [itemCategoryId, setItemCategoryId] = useState(categories[0]?.id ?? '');
  const [itemImageUrl, setItemImageUrl] = useState(PRESET_DISH_IMAGES[0].url);
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemPopular, setItemPopular] = useState(false);
  const [itemStock, setItemStock] = useState('40');
  const [itemLowThreshold, setItemLowThreshold] = useState('8');
  const [itemSizes, setItemSizes] = useState<ProductSize[]>([]);
  const [itemExtras, setItemExtras] = useState<ProductExtra[]>([]);

  // Inline new size/extra inputs
  const [newSizeLabel, setNewSizeLabel] = useState('');
  const [newSizeDelta, setNewSizeDelta] = useState('0');
  const [newExtraLabel, setNewExtraLabel] = useState('');
  const [newExtraPrice, setNewExtraPrice] = useState('15');
  const [newExtraFree, setNewExtraFree] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleCatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    setSaving(true);
    try {
      await onSaveCategory({
        id: editingCatId ?? undefined,
        name: catName.trim(),
        description: catDesc.trim(),
        sortOrder: editingCatId
          ? categories.find((c) => c.id === editingCatId)?.sortOrder ?? 1
          : categories.length + 1,
      });
      setCatName('');
      setCatDesc('');
      setEditingCatId(null);
    } finally {
      setSaving(false);
    }
  };

  const openNewItemForm = () => {
    setEditingItemId(null);
    setItemName('');
    setItemDesc('');
    setItemPrice('120');
    setItemCategoryId(categories[0]?.id ?? '');
    setItemImageUrl(PRESET_DISH_IMAGES[0].url);
    setItemAvailable(true);
    setItemPopular(false);
    setItemStock('40');
    setItemLowThreshold('8');
    setItemSizes([{ id: `sz_${Date.now()}`, label: 'حجم قياسي', priceDelta: 0, isDefault: true }]);
    setItemExtras([]);
    setShowItemForm(true);
  };

  const openEditItemForm = (item: MenuItem) => {
    setEditingItemId(item.id);
    setItemName(item.name);
    setItemDesc(item.description);
    setItemPrice(String(item.price));
    setItemCategoryId(item.categoryId);
    setItemImageUrl(item.imageUrl || PRESET_DISH_IMAGES[0].url);
    setItemAvailable(item.isAvailable);
    setItemPopular(Boolean(item.isPopular));
    setItemStock(String(item.stockQuantity ?? 40));
    setItemLowThreshold(String(item.lowStockThreshold ?? 8));
    setItemSizes(item.sizes ?? []);
    setItemExtras(item.extras ?? []);
    setShowItemForm(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      setItemImageUrl(url);
    } finally {
      setUploading(false);
    }
  };

  const addSizeOption = () => {
    if (!newSizeLabel.trim()) return;
    const delta = Number(newSizeDelta) || 0;
    setItemSizes((prev) => [
      ...prev,
      {
        id: `sz_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        label: newSizeLabel.trim(),
        priceDelta: delta,
        isDefault: prev.length === 0,
      },
    ]);
    setNewSizeLabel('');
    setNewSizeDelta('0');
  };

  const addExtraOption = () => {
    if (!newExtraLabel.trim()) return;
    const price = newExtraFree ? 0 : Math.max(0, Number(newExtraPrice) || 0);
    setItemExtras((prev) => [
      ...prev,
      {
        id: `ex_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        label: newExtraLabel.trim(),
        price,
        isFree: newExtraFree,
      },
    ]);
    setNewExtraLabel('');
    setNewExtraPrice('15');
    setNewExtraFree(false);
  };

  const handleItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericPrice = Number(itemPrice);
    if (!itemName.trim() || !itemCategoryId || !Number.isFinite(numericPrice) || numericPrice < 0) {
      return;
    }
    setSaving(true);
    try {
      await onSaveItem({
        id: editingItemId ?? undefined,
        categoryId: itemCategoryId,
        name: itemName.trim(),
        description: itemDesc.trim(),
        price: numericPrice,
        imageUrl: itemImageUrl,
        isAvailable: itemAvailable,
        isPopular: itemPopular,
        stockQuantity: Math.max(0, Math.floor(Number(itemStock) || 0)),
        lowStockThreshold: Math.max(1, Math.floor(Number(itemLowThreshold) || 8)),
        sizes: itemSizes,
        extras: itemExtras,
        sortOrder: editingItemId
          ? items.find((i) => i.id === editingItemId)?.sortOrder ?? 99
          : items.length + 1,
      });
      setShowItemForm(false);
    } finally {
      setSaving(false);
    }
  };

  const moveItem = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const copy = [...items];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    await onReorderItems(copy.map((i) => i.id));
  };

  const displayedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((i) => {
      if (filterCatId !== 'all' && i.categoryId !== filterCatId) return false;
      if (filterAvail === 'available' && !i.isAvailable) return false;
      if (filterAvail === 'unavailable' && i.isAvailable) return false;
      if (q && !i.name.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [items, filterCatId, filterAvail, searchQuery]);

  // Dedicated 2-Column Product Editor matching Editing_food_product_form
  if (showItemForm) {
    return (
      <form onSubmit={handleItemSubmit} className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-[#5C6B63]">
              الرئيسية / إدارة القائمة / {editingItemId ? 'تعديل منتج' : 'إضافة منتج'}
            </p>
            <h2 className="text-2xl font-extrabold text-[#18221D] mt-1">
              إضافة أو تعديل منتج غذائي
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setShowItemForm(false)}
            className="min-h-[40px] px-4 rounded-xl bg-white border border-[#176B45]/15 text-xs font-bold text-[#5C6B63] hover:text-[#18221D] flex items-center gap-1.5 cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span>العودة للقائمة</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Right Column: Basic Product Info (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-[#176B45]/10 p-6 shadow-xs space-y-4">
            <div>
              <label className="block text-xs font-extrabold text-[#18221D] mb-1.5">
                اسم المنتج
              </label>
              <input
                type="text"
                required
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="مثال: كباب وكفتة مشكل على الفحم"
                className="w-full h-11 px-4 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm text-[#18221D] placeholder:text-[#7A8880]"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-[#18221D] mb-1.5">
                وصف المنتج
              </label>
              <textarea
                rows={4}
                value={itemDesc}
                onChange={(e) => setItemDesc(e.target.value)}
                placeholder="وصف المكونات وطريقة التحضير..."
                className="w-full p-4 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm text-[#18221D] placeholder:text-[#7A8880]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-extrabold text-[#18221D] mb-1.5">الفئة</label>
                <select
                  value={itemCategoryId}
                  onChange={(e) => setItemCategoryId(e.target.value)}
                  className="w-full h-11 px-3 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm font-semibold text-[#18221D]"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-[#18221D] mb-1.5">
                  السعر الأساسي ({currency})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  required
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm font-bold text-[#18221D] tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-extrabold text-[#18221D] mb-1.5">
                  الكمية المتاحة في المخزون
                </label>
                <input
                  type="number"
                  min="0"
                  value={itemStock}
                  onChange={(e) => setItemStock(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm font-bold text-[#18221D] tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold text-[#18221D] mb-1.5">
                  حد التنبيه لانخفاض المخزون
                </label>
                <input
                  type="number"
                  min="1"
                  value={itemLowThreshold}
                  onChange={(e) => setItemLowThreshold(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-[#F7F3E9]/60 border border-[#176B45]/15 text-sm font-bold text-[#18221D] tabular-nums"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemAvailable}
                  onChange={(e) => setItemAvailable(e.target.checked)}
                  className="w-4 h-4 accent-[#176B45]"
                />
                <span className="text-sm font-bold text-[#18221D]">متوفر حالياً للطلب</span>
              </label>

              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemPopular}
                  onChange={(e) => setItemPopular(e.target.checked)}
                  className="w-4 h-4 accent-[#176B45]"
                />
                <span className="text-sm font-bold text-[#18221D]">تمييز كطبق الأكثر طلباً</span>
              </label>
            </div>
          </div>

          {/* Left Column: Image Dropzone, Sizes, & Extras (5 cols) */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-[#176B45]/10 p-6 shadow-xs space-y-5">
            {/* Image Dropzone */}
            <div className="space-y-2.5">
              <label className="block text-xs font-extrabold text-[#18221D]">صورة المنتج</label>
              <div className="rounded-2xl border-2 border-dashed border-[#176B45]/25 bg-[#F7F3E9]/60 p-4 text-center space-y-3">
                <SafeImage
                  src={itemImageUrl}
                  alt={itemName || 'معاينة'}
                  className="w-36 h-24 rounded-xl object-cover mx-auto border border-[#176B45]/15 bg-[#EFE9DC]"
                  fallbackIconClassName="w-8 h-8"
                />
                <label className="inline-flex items-center gap-2 min-h-[38px] px-4 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-bold cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploading ? 'جاري الرفع...' : 'تغيير الصورة أو تصفح جهازك'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_DISH_IMAGES.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => setItemImageUrl(preset.url)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                      itemImageUrl === preset.url
                        ? 'bg-[#176B45] text-white border-[#176B45]'
                        : 'bg-[#F7F3E9] text-[#35443C] border-[#176B45]/10'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sizes Editor */}
            <div className="space-y-2 border-t border-[#176B45]/10 pt-4">
              <label className="block text-xs font-extrabold text-[#18221D]">
                أحجام المنتج (فارق السعر عن الأساسي)
              </label>
              <div className="space-y-1.5">
                {itemSizes.map((sz) => (
                  <div
                    key={sz.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F7F3E9]/70 text-xs text-[#18221D]"
                  >
                    <label className="flex items-center gap-2 font-bold cursor-pointer min-w-0">
                      <input
                        type="radio"
                        checked={Boolean(sz.isDefault)}
                        onChange={() =>
                          setItemSizes((prev) =>
                            prev.map((s) => ({ ...s, isDefault: s.id === sz.id }))
                          )
                        }
                        className="accent-[#176B45] shrink-0"
                      />
                      <span className="truncate">{sz.label}</span>
                      <span className="text-[#176B45] tabular-nums shrink-0">
                        ({sz.priceDelta >= 0 ? `+${sz.priceDelta}` : sz.priceDelta} {currency})
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setItemSizes((prev) => prev.filter((s) => s.id !== sz.id))
                      }
                      className="text-red-600 hover:text-red-800 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="text"
                  value={newSizeLabel}
                  onChange={(e) => setNewSizeLabel(e.target.value)}
                  placeholder="اسم الحجم (مثال: كيلو كامل)"
                  className="flex-1 min-w-[130px] h-9 px-2.5 rounded-lg bg-[#F7F3E9] border border-[#176B45]/15 text-xs text-[#18221D] placeholder:text-[#7A8880]"
                />
                <input
                  type="number"
                  value={newSizeDelta}
                  onChange={(e) => setNewSizeDelta(e.target.value)}
                  placeholder="فرق السعر"
                  className="w-20 h-9 px-2 rounded-lg bg-[#F7F3E9] border border-[#176B45]/15 text-xs text-[#18221D] placeholder:text-[#7A8880] tabular-nums"
                />
                <button
                  type="button"
                  onClick={addSizeOption}
                  className="h-9 px-3 rounded-lg bg-[#176B45] text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  + إضافة
                </button>
              </div>
            </div>

            {/* Extras Editor */}
            <div className="space-y-2 border-t border-[#176B45]/10 pt-4">
              <label className="block text-xs font-extrabold text-[#18221D]">
                الإضافات المدفوعة والمجانية
              </label>
              <div className="space-y-1.5">
                {itemExtras.map((ex) => (
                  <div
                    key={ex.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#F7F3E9]/70 text-xs text-[#18221D]"
                  >
                    <span className="font-bold">
                      {ex.label}{' '}
                      <span className="text-[#176B45] tabular-nums">
                        ({ex.isFree ? 'مجاناً' : `${ex.price} ${currency}`})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setItemExtras((prev) => prev.filter((e) => e.id !== ex.id))
                      }
                      className="text-red-600 hover:text-red-800 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="text"
                  value={newExtraLabel}
                  onChange={(e) => setNewExtraLabel(e.target.value)}
                  placeholder="اسم الإضافة (مثال: جبنة سايحة)"
                  className="flex-1 min-w-[140px] h-9 px-2.5 rounded-lg bg-[#F7F3E9] border border-[#176B45]/15 text-xs text-[#18221D] placeholder:text-[#7A8880]"
                />
                <input
                  type="number"
                  min="0"
                  disabled={newExtraFree}
                  value={newExtraFree ? '0' : newExtraPrice}
                  onChange={(e) => setNewExtraPrice(e.target.value)}
                  className="w-16 h-9 px-2 rounded-lg bg-[#F7F3E9] border border-[#176B45]/15 text-xs text-[#18221D] tabular-nums disabled:opacity-50"
                />
                <label className="flex items-center gap-1 text-[11px] font-bold text-[#18221D] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newExtraFree}
                    onChange={(e) => setNewExtraFree(e.target.checked)}
                    className="accent-[#176B45]"
                  />
                  <span>مجانية</span>
                </label>
                <button
                  type="button"
                  onClick={addExtraOption}
                  className="h-9 px-3 rounded-lg bg-[#176B45] text-white text-xs font-bold cursor-pointer"
                >
                  + إضافة
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setShowItemForm(false)}
            className="min-h-[44px] px-6 rounded-xl bg-white border border-[#176B45]/20 text-sm font-bold text-[#18221D] cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={saving || uploading}
            className="min-h-[44px] px-8 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-sm font-extrabold cursor-pointer disabled:opacity-50"
          >
            {saving ? 'جاري الحفظ...' : 'حفظ المنتج'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header matching Menu_management_dashboard_layout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#18221D]">إدارة القائمة</h2>
          <p className="text-xs sm:text-sm text-[#5C6B63] mt-0.5">
            تعديل وإضافة الأطباق، الأحجام، الإضافات، والأسعار في {restaurant.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewItemForm}
          className="min-h-[44px] px-5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer shrink-0 shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة منتج جديد</span>
        </button>
      </div>

      {/* Category Management Card */}
      <div className="bg-white rounded-2xl border border-[#176B45]/10 p-5 space-y-4 shadow-xs">
        <h3 className="text-sm font-extrabold text-[#18221D]">أقسام المنيو</h3>

        <form onSubmit={handleCatSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            value={catName}
            onChange={(e) => setCatName(e.target.value)}
            placeholder="اسم القسم (مثال: طواجن الفخار)"
            className="h-11 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm text-[#18221D] placeholder:text-[#7A8880]"
          />
          <input
            type="text"
            value={catDesc}
            onChange={(e) => setCatDesc(e.target.value)}
            placeholder="وصف مختصر للقسم (اختياري)"
            className="h-11 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/15 text-sm text-[#18221D] placeholder:text-[#7A8880]"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || !catName.trim()}
              className="flex-1 h-11 rounded-xl bg-[#104B34] hover:bg-[#176B45] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {editingCatId ? 'حفظ تعديل القسم' : 'إضافة قسم'}
            </button>
            {editingCatId && (
              <button
                type="button"
                onClick={() => {
                  setEditingCatId(null);
                  setCatName('');
                  setCatDesc('');
                }}
                className="px-3 h-11 rounded-xl bg-[#F7F3E9] text-xs font-bold text-[#18221D] cursor-pointer"
              >
                إلغاء
              </button>
            )}
          </div>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="rounded-xl bg-[#FAF7F0] border border-[#176B45]/10 p-3 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-extrabold text-[#18221D] truncate">{cat.name}</p>
                <p className="text-[11px] text-[#5C6B63] tabular-nums">
                  {items.filter((i) => i.categoryId === cat.id).length} أصناف
                </p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCatId(cat.id);
                    setCatName(cat.name);
                    setCatDesc(cat.description ?? '');
                  }}
                  aria-label={`تعديل ${cat.name}`}
                  className="w-7 h-7 rounded-lg hover:bg-white text-[#176B45] flex items-center justify-center cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteCategory(cat.id)}
                  aria-label={`حذف ${cat.name}`}
                  className="w-7 h-7 rounded-lg hover:bg-white text-red-600 flex items-center justify-center cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters & Products Table matching Menu_management_dashboard_layout */}
      <div className="bg-white rounded-2xl border border-[#176B45]/10 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-[#176B45]/10 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#5C6B63] absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث عن منتج..."
              className="w-full h-10 pr-10 pl-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/10 text-sm text-[#18221D] placeholder:text-[#7A8880]"
            />
          </div>
          <select
            value={filterAvail}
            onChange={(e) => setFilterAvail(e.target.value as typeof filterAvail)}
            className="h-10 px-3 rounded-xl bg-[#F7F3E9] border border-[#176B45]/10 text-xs font-bold text-[#18221D]"
          >
            <option value="all">الحالة: الكل</option>
            <option value="available">متوفر فقط</option>
            <option value="unavailable">غير متوفر فقط</option>
          </select>
        </div>

        {/* Category Filter Tabs */}
        <div className="px-4 py-2.5 border-b border-[#176B45]/10 flex items-center gap-4 overflow-x-auto text-xs font-extrabold">
          <button
            type="button"
            onClick={() => setFilterCatId('all')}
            className={`pb-1.5 border-b-2 whitespace-nowrap cursor-pointer ${
              filterCatId === 'all'
                ? 'border-[#104B34] text-[#104B34]'
                : 'border-transparent text-[#5C6B63]'
            }`}
          >
            الكل ({items.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilterCatId(cat.id)}
              className={`pb-1.5 border-b-2 whitespace-nowrap cursor-pointer ${
                filterCatId === cat.id
                  ? 'border-[#104B34] text-[#104B34]'
                  : 'border-transparent text-[#5C6B63]'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#F3F4F2] text-xs font-bold text-[#5C6B63]">
              <tr>
                <th className="py-3 px-4">المنتج</th>
                <th className="py-3 px-4">الفئة</th>
                <th className="py-3 px-4">السعر ({currency})</th>
                <th className="py-3 px-4">المخزون</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">العمليات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#176B45]/10">
              {displayedItems.map((item) => {
                const catName =
                  categories.find((c) => c.id === item.categoryId)?.name ?? '—';
                const fullIndex = items.findIndex((i) => i.id === item.id);
                const stockQty = item.stockQuantity ?? 0;
                const lowThreshold = item.lowStockThreshold ?? 8;
                const lowStock = stockQty <= lowThreshold;
                return (
                  <tr key={item.id} className="hover:bg-[#F7F3E9]/50">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <SafeImage
                          src={item.imageUrl}
                          alt={item.name}
                          className="w-14 h-11 rounded-xl object-cover bg-[#EFE9DC] shrink-0"
                          fallbackIconClassName="w-5 h-5"
                        />
                        <div>
                          <p className="font-extrabold text-[#18221D]">{item.name}</p>
                          <p className="text-[11px] text-[#5C6B63]">
                            {(item.sizes?.length ?? 0)} أحجام · {(item.extras?.length ?? 0)} إضافات
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold text-[#5C6B63]">{catName}</td>
                    <td className="py-3 px-4 font-extrabold tabular-nums text-[#104B34]">
                      {formatCurrency(item.price, currency)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold tabular-nums ${
                          lowStock
                            ? 'bg-red-100 text-red-800'
                            : 'bg-[#F3F4F2] text-[#35443C]'
                        }`}
                      >
                        {item.stockQuantity ?? 0} وحدة
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() =>
                          onSaveItem({ ...item, isAvailable: !item.isAvailable })
                        }
                        aria-label="تبديل حالة التوفر"
                        className={`w-12 h-6 rounded-full p-0.5 transition-colors cursor-pointer flex items-center ${
                          item.isAvailable ? 'bg-[#176B45] justify-start' : 'bg-neutral-300 justify-end'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
                      </button>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        {filterCatId === 'all' && !searchQuery && (
                          <>
                            <button
                              type="button"
                              onClick={() => moveItem(fullIndex, -1)}
                              disabled={fullIndex === 0}
                              title="تحريك لأعلى"
                              className="w-8 h-8 rounded-lg hover:bg-[#F7F3E9] disabled:opacity-30 flex items-center justify-center cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveItem(fullIndex, 1)}
                              disabled={fullIndex === items.length - 1}
                              title="تحريك لأسفل"
                              className="w-8 h-8 rounded-lg hover:bg-[#F7F3E9] disabled:opacity-30 flex items-center justify-center cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditItemForm(item)}
                          title="تعديل"
                          className="w-8 h-8 rounded-lg border border-[#176B45]/15 hover:bg-[#F7F3E9] text-[#176B45] flex items-center justify-center cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          title="حذف"
                          className="w-8 h-8 rounded-lg border border-red-200 hover:bg-red-50 text-red-600 flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
