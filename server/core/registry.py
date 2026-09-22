"""
core/registry.py — الـWhitelist الصارمة لمحرك الـMaker-Checker.

بدون الملف ده، أي حد يقدر يبعت entity_type: "auth.User" أو
"admin.LogEntry" ويحاول يخلي الـDynamic Dispatcher يحقن بيانات في
موديلات حساسة مالهاش علاقة بنظام الموافقات خالص. كل موديول لازم يسجّل
نفسه هنا صراحة عشان يقدر يعدّي عبر الـMaker-Checker — تسجيل صريح، مش
اكتشاف تلقائي (auto-discovery) اللي ممكن يسجّل حاجة من غير قصد.

كل App بينادي register() مرة واحدة في apps.py's ready() بتاعته.
"""

_REGISTRY = {}

# افتراضيًا، أي entity_type بيسجّل نفسه بيتحمي تلقائيًا من محاولة تمرير
# الحقول دي في proposed_data — حقول حساسة (صلاحيات، ملكية، حالة النظام
# نفسها) ما ينفعش تتغيّر عبر مسار Maker-Checker العادي إلا لو الموديول
# سمح بيها صراحة وقت التسجيل. القائمة دي عامة (مش خاصة بـModel معيّن)
# عشان تغطي أي Entity مستقبلي (زي User لو سُجّل يومًا ما).
DEFAULT_PROTECTED_FIELDS = frozenset({
    "id", "pk", "is_staff", "is_superuser", "password",
    "role", "permissions", "user_permissions", "groups",
    "maker", "checker", "status", "created_by",
    # ملاحظة: "is_active" اتشالت عمدًا من القائمة العامة دي — اسم عام
    # جدًا بيستخدمه موديلات كتير بمعاني عملية شرعية بحتة (زي
    # Account.is_active اللي معناها "الحساب فعّال في الشجرة"، مش أي
    # علاقة بصلاحيات نظام). اتكشف ده عبر اختبار Regression فعلي كشف
    # Over-blocking حقيقي (تعطيل حساب في شجرة الحسابات كان بيترفض
    # بالغلط). لو Entity معيّن (زي User لو اتسجّل يومًا ما) محتاج
    # "is_active" محمية فعلًا، يضيفها بنفسه في protected_fields وقت
    # التسجيل — مش قائمة عامة تفترض نفس المعنى لكل موديل.
})


def register(entity_type: str, *, model_path: str, serializer_class, protected_fields=None, extra_apply_kwargs_fn=None):
    """
    entity_type: اسم قصير بيستخدمه الـFrontend/الـAPI (مثال: "account")
    model_path: "app_label.ModelName" (مثال: "core.Account")
    serializer_class: الـSerializer اللي هيتستخدم وقت التطبيق الفعلي —
        نفس الـSerializer المستخدم في الـViewSet العادي، عشان الـ
        validation تفضل واحدة موحّدة مش نسختين ممكن يختلفوا.
    protected_fields: مجموعة أسماء حقول إضافية ممنوعة لهذا الـEntity
        تحديدًا، فوق الـDEFAULT_PROTECTED_FIELDS.
    extra_apply_kwargs_fn: دالة اختيارية بتاخد ChangeRequest وترجع
        dict من الـkwargs الإضافية اللازمة وقت serializer.save() —
        مثال: lambda cr: {"created_by": cr.maker}. لازم للموديلات
        اللي عندها حقول إجبارية (زي created_by) متجيش من proposed_data
        نفسها (لأنها محمية أصلًا كـProtected Field) لكن لازم تتحدد من
        سياق الطلب (الـmaker الأصلي، مش الـchecker اللي وافق لاحقًا).
    """
    if entity_type in _REGISTRY:
        raise ValueError(f"'{entity_type}' مسجّل بالفعل في Maker-Checker Registry — كل entity_type لازم يكون فريد.")
    _REGISTRY[entity_type] = {
        "model_path": model_path,
        "serializer_class": serializer_class,
        "protected_fields": DEFAULT_PROTECTED_FIELDS | set(protected_fields or set()),
        "extra_apply_kwargs_fn": extra_apply_kwargs_fn,
    }


def unregister(entity_type: str):
    """للاستخدام في الاختبارات بس — تسجيل Entity مؤقت في tearDown."""
    _REGISTRY.pop(entity_type, None)


def is_registered(entity_type: str) -> bool:
    return entity_type in _REGISTRY


def get_registration(entity_type: str) -> dict:
    """
    بيرمي ValueError صريح لو entity_type مش في الـWhitelist — الفحص ده
    هو خط الدفاع الأول ضد أي محاولة حقن موديل مش مقصود يعدّي عبر النظام.
    """
    if entity_type not in _REGISTRY:
        raise ValueError(f"'{entity_type}' غير مسجّل في نظام Maker-Checker — الطلب مرفوض.")
    return _REGISTRY[entity_type]


def get_model_class(entity_type: str):
    from django.apps import apps

    reg = get_registration(entity_type)
    app_label, model_name = reg["model_path"].split(".")
    return apps.get_model(app_label, model_name)


def registered_entity_types() -> list:
    """للاستخدام في الأدمن/الـDebugging — عرض كل الـEntities المسجّلة حاليًا."""
    return sorted(_REGISTRY.keys())