-- =====================================================================
-- موظف المطعم (مشويات الحارة) — بيانات التهيئة الأولية (Idempotent Seed)
-- آمن لإعادة التشغيل أكثر من مرة عبر ON CONFLICT DO NOTHING
-- =====================================================================

-- 1. المطعم الافتراضي وإعداداته
insert into public.restaurants (
  id, slug, name, description, address, phone, whatsapp_number, logo_url,
  manual_status, weekly_schedule, schedule_exceptions, ai_settings, system_settings
)
values (
  'rest_meshweyat_elhara',
  'meshweyat-elhara',
  'مشويات الحارة',
  'أصل المشويات المصرية على الفحم — لحوم بلدي طازجة وتتبيلة الحارة الخاصة، تُشوى وقت الطلب وتوصلك سخنة.',
  '١٨ شارع عباس العقاد، مدينة نصر، القاهرة',
  '01098765432',
  '201098765432',
  '/src/assets/images/logo_meshweyat_elhara_1794772425337.jpg',
  'auto',
  '[
    {"day":"saturday","labelAr":"السبت","isClosed":false,"openTime":"12:00","closeTime":"01:30"},
    {"day":"sunday","labelAr":"الأحد","isClosed":false,"openTime":"12:00","closeTime":"01:00"},
    {"day":"monday","labelAr":"الإثنين","isClosed":false,"openTime":"12:00","closeTime":"01:00"},
    {"day":"tuesday","labelAr":"الثلاثاء","isClosed":false,"openTime":"12:00","closeTime":"01:00"},
    {"day":"wednesday","labelAr":"الأربعاء","isClosed":false,"openTime":"12:00","closeTime":"01:00"},
    {"day":"thursday","labelAr":"الخميس","isClosed":false,"openTime":"12:00","closeTime":"02:00"},
    {"day":"friday","labelAr":"الجمعة","isClosed":false,"openTime":"13:30","closeTime":"02:00"}
  ]'::jsonb,
  '[
    {"id":"exc_sample_1","date":"2026-12-31","label":"سهرة رأس السنة (مواعيد ممتدة)","isClosed":false,"openTime":"12:00","closeTime":"03:00"}
  ]'::jsonb,
  '{
    "enabled": true,
    "aiOrderIntake": true,
    "model": "gemini-4-hydrogen",
    "welcomeMessage": "أهلاً وسهلاً بيك في مشويات الحارة ❤️ نورتنا، تحب أساعدك في إيه؟ تقدر تسألني عن المنيو أو مواعيد العمل أو التوصيل، أو تطلب أكلك مباشرة.",
    "tone": "friendly_egyptian",
    "allowedTopics": {"menuAndPrices": true, "workingHours": true, "deliveryZones": true, "orderIntake": true},
    "customInstructions": "التزم بالعامية المصرية المهذبة والمختصرة، ووضح إن كل الأسعار بالجنيه المصري."
  }'::jsonb,
  '{
    "currencyLabel": "ج.م",
    "currencyCode": "EGP",
    "timezone": "Africa/Cairo",
    "supportEmail": "support@hara-grill.eg",
    "requirePhoneVerificationNote": true,
    "allowOrdersWhenClosed": false,
    "taxPercent": 0
  }'::jsonb
)
on conflict (id) do nothing;

-- 2. الفروع
insert into public.branches (id, restaurant_id, name, address, phone, hours_text, is_open)
values
  ('br_nasr_city', 'rest_meshweyat_elhara', 'فرع مدينة نصر (الرئيسي)', '١٨ شارع عباس العقاد، مدينة نصر، القاهرة', '01098765432', '١٢:٠٠ م - ١:٣٠ ص', true),
  ('br_heliopolis', 'rest_meshweyat_elhara', 'فرع مصر الجديدة', '٤٢ شارع الثورة، مصر الجديدة، القاهرة', '01011223344', '١٢:٠٠ م - ٢:٠٠ ص', true),
  ('br_fifth_settlement', 'rest_meshweyat_elhara', 'فرع التجمع الخامس', 'شارع التسعين الشمالي، التجمع الخامس، القاهرة', '01055667788', '١٢:٠٠ م - ١٢:٠٠ ص', true)
on conflict (id) do nothing;

-- 3. أقسام المنيو
insert into public.menu_categories (id, restaurant_id, name, description, sort_order)
values
  ('cat_grills', 'rest_meshweyat_elhara', 'المشويات', 'مشويات على الفحم من اللحم والدجاج البلدي الطازج', 1),
  ('cat_hawawshi_sandwiches', 'rest_meshweyat_elhara', 'الحواوشي والسندوتشات', 'حواوشي بلدي مقرمش وسندوتشات مشوية في عيش طازج', 2),
  ('cat_appetizers', 'rest_meshweyat_elhara', 'المقبلات والسلطات', 'سلطات ومقبلات مصرية طازجة تُحضر يومياً', 3),
  ('cat_desserts', 'rest_meshweyat_elhara', 'الحلويات', 'حلويات شرقية ساخنة تُحضر يومياً في الفرن', 4),
  ('cat_drinks', 'rest_meshweyat_elhara', 'المشروبات', 'عصائر طبيعية ومشروبات مثلجة منعشة', 5)
on conflict (id) do nothing;

-- 4. أصناف المنيو (16 صنف)
insert into public.menu_items (
  id, restaurant_id, category_id, name, description, price, image_url,
  is_available, is_popular, stock_quantity, low_stock_threshold, sizes, extras, sort_order
)
values
  ('item_kebab_kofta_mix', 'rest_meshweyat_elhara', 'cat_grills', 'كباب وكفتة مشكل',
   'قطع كباب بتلو وكفتة حاتي مشوية على الفحم مع بصل وطماطم مشوية وعيش بلدي.', 340,
   '/src/assets/images/dish_kebab_kofta_1794772426751.jpg', true, true, 42, 8,
   '[{"id":"sz_half","label":"نصف كيلو","priceDelta":0,"isDefault":true},{"id":"sz_kilo","label":"كيلو كامل","priceDelta":320}]'::jsonb,
   '[{"id":"ex_extra_tahini","label":"طحينة زيادة","price":15,"isFree":false},{"id":"ex_basmati_rice","label":"أرز بسمتي مبهر","price":35,"isFree":false},{"id":"ex_grilled_onion","label":"بصل وطماطم مشوية","price":0,"isFree":true}]'::jsonb, 1),
  ('item_kofta_hati', 'rest_meshweyat_elhara', 'cat_grills', 'كفتة حاتي على الفحم',
   'لحم مفروم بلدي متبل بالبصل والتوابل المصرية، يُقدم مع سلطة طحينة وعيش ساخن.', 250,
   '/src/assets/images/dish_kebab_kofta_1794772426751.jpg', true, true, 55, 10,
   '[{"id":"sz_quarter","label":"ربع كيلو","priceDelta":-115},{"id":"sz_half","label":"نصف كيلو","priceDelta":0,"isDefault":true},{"id":"sz_kilo","label":"كيلو كامل","priceDelta":230}]'::jsonb,
   '[{"id":"ex_extra_bread","label":"عيش بلدي ساخن زيادة","price":10,"isFree":false},{"id":"ex_spicy_pepper","label":"فلفل مشوي حار","price":0,"isFree":true}]'::jsonb, 2),
  ('item_lamb_chops', 'rest_meshweyat_elhara', 'cat_grills', 'ريش ضاني مشوية',
   'ريش ضاني طرية متبلة بالروزماري والفلفل الأسود على الفحم مع أرز بسمتي مبهر.', 390,
   '/src/assets/images/dish_lamb_chops_1794772427306.jpg', true, true, 6, 8,
   '[{"id":"sz_half","label":"نصف كيلو","priceDelta":0,"isDefault":true},{"id":"sz_kilo","label":"كيلو كامل","priceDelta":370}]'::jsonb,
   '[{"id":"ex_basmati_rice","label":"أرز بسمتي مبهر","price":35,"isFree":false},{"id":"ex_garlic_dip","label":"ثومية لبنانية","price":15,"isFree":false}]'::jsonb, 3),
  ('item_shish_tarab_platter', 'rest_meshweyat_elhara', 'cat_grills', 'وجبة شيش طاووق وطرب مشوي',
   'أسياخ شيش طاووق متبلة مع أصابع طرب مشوية وأرز بالزعفران وطحينة.', 270,
   '/src/assets/images/dish_shish_tarab_1794772427324.jpg', true, true, 30, 6,
   '[{"id":"sz_single","label":"وجبة فردية","priceDelta":0,"isDefault":true},{"id":"sz_double","label":"وجبة مزدوجة","priceDelta":230}]'::jsonb,
   '[{"id":"ex_extra_tarab","label":"سيخ طرب إضافي","price":65,"isFree":false},{"id":"ex_no_onion","label":"بدون بصل","price":0,"isFree":true}]'::jsonb, 4),
  ('item_hawawshi_baladi', 'rest_meshweyat_elhara', 'cat_hawawshi_sandwiches', 'حواوشي بلدي على الفحم',
   'رغيف عيش بلدي محشو لحم مفروم متبل وفلفل أخضر وبصل، مخبوز على الفحم مع مخلل وطحينة.', 95,
   '/src/assets/images/dish_hawawshi_1794772427406.jpg', true, true, 64, 12,
   '[{"id":"sz_regular","label":"رغيف عادي","priceDelta":0,"isDefault":true},{"id":"sz_double","label":"رغيف لحم دبل","priceDelta":45}]'::jsonb,
   '[{"id":"ex_mozzarella","label":"جبنة موتزاريلا سايحة","price":20,"isFree":false},{"id":"ex_spicy_sausage","label":"إضافة سجق بلدي","price":25,"isFree":false},{"id":"ex_extra_pickles","label":"مخلل بلدي زيادة","price":0,"isFree":true}]'::jsonb, 5),
  ('item_sandwich_kofta', 'rest_meshweyat_elhara', 'cat_hawawshi_sandwiches', 'ساندوتش كفتة حاتي',
   'أسياخ كفتة مشوية ملفوفة في عيش طازج مع بقدونس وسلطة طحينة وبصل بالسماق.', 75,
   '/src/assets/images/dish_sandwiches_1794772427710.jpg', true, false, 48, 10,
   '[{"id":"sz_regular","label":"عادي","priceDelta":0,"isDefault":true},{"id":"sz_jumbo","label":"جامبو","priceDelta":30}]'::jsonb,
   '[{"id":"ex_tahini_extra","label":"طحينة زيادة","price":10,"isFree":false},{"id":"ex_no_parsley","label":"بدون بقدونس وبصل","price":0,"isFree":true}]'::jsonb, 6),
  ('item_sandwich_shish', 'rest_meshweyat_elhara', 'cat_hawawshi_sandwiches', 'ساندوتش شيش طاووق',
   'قطع دجاج مشوية متبلة بالزبادي والليمون مع ثومية ومخلل خيار.', 70,
   '/src/assets/images/dish_sandwiches_1794772427710.jpg', true, false, 4, 8,
   '[{"id":"sz_regular","label":"عادي","priceDelta":0,"isDefault":true},{"id":"sz_syrian","label":"عيش سوري محمص","priceDelta":15}]'::jsonb,
   '[{"id":"ex_cheddar_sauce","label":"صوص شيدر","price":15,"isFree":false},{"id":"ex_garlic_free","label":"ثومية زيادة","price":0,"isFree":true}]'::jsonb, 7),
  ('item_sandwich_tarab', 'rest_meshweyat_elhara', 'cat_hawawshi_sandwiches', 'ساندوتش طرب مشوي',
   'أصابع طرب مشوية على الفحم داخل عيش سوري أو بلدي مع طحينة.', 90,
   '/src/assets/images/dish_sandwiches_1794772427710.jpg', false, false, 0, 5,
   '[{"id":"sz_regular","label":"عادي","priceDelta":0,"isDefault":true}]'::jsonb, '[]'::jsonb, 8),
  ('item_tahini_salad', 'rest_meshweyat_elhara', 'cat_appetizers', 'سلطة طحينة بالكمون',
   'طحينة سمسم أصلية بالليمون والكمون والثوم وزيت الزيتون.', 30,
   '/src/assets/images/dish_mezze_salads_1794772429086.jpg', true, false, 80, 15,
   '[{"id":"sz_small","label":"صغير","priceDelta":0,"isDefault":true},{"id":"sz_family","label":"عائلي","priceDelta":25}]'::jsonb,
   '[{"id":"ex_olive_oil","label":"رشة زيت زيتون","price":0,"isFree":true}]'::jsonb, 9),
  ('item_baba_ghanoush', 'rest_meshweyat_elhara', 'cat_appetizers', 'سلطة بابا غنوج مشوي',
   'باذنجان مشوي على الفحم مهروس مع الطحينة والرمان والزيت.', 35,
   '/src/assets/images/dish_mezze_salads_1794772429086.jpg', true, false, 60, 10,
   '[{"id":"sz_regular","label":"طبق وسط","priceDelta":0,"isDefault":true}]'::jsonb, '[]'::jsonb, 10),
  ('item_baladi_salad', 'rest_meshweyat_elhara', 'cat_appetizers', 'سلطة خضراء بلدي',
   'طماطم وخيار وجرجير وبصل طازج بتتبيلة الليمون والكمون.', 25,
   '/src/assets/images/dish_mezze_salads_1794772429086.jpg', true, false, 75, 12,
   '[{"id":"sz_regular","label":"طبق وسط","priceDelta":0,"isDefault":true}]'::jsonb,
   '[{"id":"ex_lemon_cup","label":"ليمون إضافي","price":0,"isFree":true}]'::jsonb, 11),
  ('item_crispy_fries', 'rest_meshweyat_elhara', 'cat_appetizers', 'طبق بطاطس محمرة مقرمشة',
   'بطاطس مقرمشة متبلة ببهارات الحارة مع كاتشب.', 40,
   '/src/assets/images/dish_mezze_salads_1794772429086.jpg', true, false, 50, 10,
   '[{"id":"sz_medium","label":"وسط","priceDelta":0,"isDefault":true},{"id":"sz_family","label":"عائلي","priceDelta":25}]'::jsonb,
   '[{"id":"ex_cheese_sauce","label":"صوص جبنة شيدر","price":15,"isFree":false},{"id":"ex_ketchup","label":"كاتشب زيادة","price":0,"isFree":true}]'::jsonb, 12),
  ('item_om_ali', 'rest_meshweyat_elhara', 'cat_desserts', 'طاجن أم علي بالمكسرات',
   'رقائق مقرمشة بالحليب الطازج والقشطة والمكسرات المحمصة والقرفة في الفرن.', 65,
   '/src/assets/images/dish_om_ali_dessert_1794773312294.jpg', true, true, 28, 6,
   '[{"id":"sz_single","label":"طاجن فردي","priceDelta":0,"isDefault":true},{"id":"sz_double","label":"طاجن عائلي","priceDelta":55}]'::jsonb,
   '[{"id":"ex_extra_nuts","label":"مكسرات وفستق إضافي","price":20,"isFree":false},{"id":"ex_ice_cream","label":"بولة آيس كريم فانيليا","price":25,"isFree":false}]'::jsonb, 13),
  ('item_mango_juice', 'rest_meshweyat_elhara', 'cat_drinks', 'عصير مانجو طبيعي',
   'عصير مانجو إسماعيلاوي طازج ومثلج بدون إضافات صناعية.', 45,
   '/src/assets/images/dish_drinks_oriental_1794772429527.jpg', true, false, 60, 10,
   '[{"id":"sz_medium","label":"كوب وسط","priceDelta":0,"isDefault":true},{"id":"sz_large","label":"كوب كبير","priceDelta":15}]'::jsonb,
   '[{"id":"ex_less_sugar","label":"سكر خفيف","price":0,"isFree":true}]'::jsonb, 14),
  ('item_lemon_mint', 'rest_meshweyat_elhara', 'cat_drinks', 'ليمون بالنعناع مثلج',
   'عصير ليمون طازج مضروب مع أوراق النعناع الفريش والثلج.', 35,
   '/src/assets/images/dish_drinks_oriental_1794772429527.jpg', true, false, 65, 10,
   '[{"id":"sz_regular","label":"كوب قياسي","priceDelta":0,"isDefault":true}]'::jsonb, '[]'::jsonb, 15),
  ('item_karkadeh', 'rest_meshweyat_elhara', 'cat_drinks', 'كركديه أسواني مثلج',
   'مشروب كركديه أسواني بارد ومنعش محلى باعتدال.', 30,
   '/src/assets/images/dish_drinks_oriental_1794772429527.jpg', true, false, 70, 10,
   '[{"id":"sz_regular","label":"كوب قياسي","priceDelta":0,"isDefault":true}]'::jsonb, '[]'::jsonb, 16)
on conflict (id) do nothing;

-- 5. مناطق التوصيل
insert into public.delivery_zones (id, restaurant_id, name, fee, min_order_amount, estimated_minutes, is_active)
values
  ('zone_nasr_city', 'rest_meshweyat_elhara', 'مدينة نصر', 25, 100, '٣٠ - ٤٥ دقيقة', true),
  ('zone_heliopolis', 'rest_meshweyat_elhara', 'مصر الجديدة', 30, 150, '٣٥ - ٥٠ دقيقة', true),
  ('zone_fifth_settlement', 'rest_meshweyat_elhara', 'التجمع الخامس', 45, 200, '٤٥ - ٦٠ دقيقة', true),
  ('zone_downtown', 'rest_meshweyat_elhara', 'وسط البلد والعباسية', 35, 120, '٤٠ - ٥٥ دقيقة', true),
  ('zone_maadi', 'rest_meshweyat_elhara', 'المعادي', 50, 250, '٥٠ - ٧٠ دقيقة', false)
on conflict (id) do nothing;

-- 6. كوبونات الخصم
insert into public.coupons (
  id, restaurant_id, code, description, discount_type, discount_value,
  min_order_amount, max_discount_amount, valid_from, valid_until, usage_limit, used_count, is_active
)
values
  ('cpn_hara10', 'rest_meshweyat_elhara', 'HARA10', 'خصم ١٠٪ على جميع طلبات المشويات فوق ٢٠٠ ج.م', 'percentage', 10, 200, 80, '2026-01-01', '2027-12-31', 500, 24, true),
  ('cpn_welcome30', 'rest_meshweyat_elhara', 'WELCOME30', 'خصم فوري ٣٠ ج.م للطلبات فوق ١٥٠ ج.م', 'fixed', 30, 150, null, '2026-01-01', '2027-12-31', 200, 15, true)
on conflict (id) do nothing;

-- 7. طاقم العمل (بدون كلمة مرور داخل الجدول)
insert into public.employees (id, restaurant_id, name, email, phone, role, must_change_password, is_active)
values
  ('emp_cashier', 'rest_meshweyat_elhara', 'محمود الكاشير', 'cashier@hara-grill.eg', '01022334455', 'cashier', true, true),
  ('emp_kitchen', 'rest_meshweyat_elhara', 'الشيف حسن إبراهيم', 'kitchen@hara-grill.eg', '01155443322', 'kitchen', true, true)
on conflict (id) do nothing;

-- 8. ربط حساب المدير تلقائياً من Supabase Auth (عند إنشائه في Authentication -> Users)
-- يمكنك استبدال البريد الإلكتروني ببريد المدير الفعلي بعد إنشائه في Supabase Auth:
-- insert into public.restaurant_admins (restaurant_id, user_id, role)
-- select 'rest_meshweyat_elhara', id, 'owner'
-- from auth.users
-- where email = 'admin@example.com'
-- on conflict (restaurant_id, user_id) do nothing;
