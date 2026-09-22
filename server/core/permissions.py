from rest_framework.permissions import BasePermission

from . import registry
from .policy import AuthorizationPolicy


class CanReviewChangeRequests(BasePermission):
    """
    Permission الخاصة بمراجعة ChangeRequests.

    Security boundary:
    1. المستخدم لازم يكون Checker صالح.
    2. المستخدم لازم يكون داخل الـscope المسموح للـChangeRequest.
    3. لا يتم إخفاء أخطاء الـRegistry/Model configuration بواسطة
       broad exception handling.
    """

    def has_permission(self, request, view):
        return AuthorizationPolicy.can_be_checker(request.user)

    def has_object_permission(self, request, view, obj):
        target_instance = None

        if obj.entity_id and registry.is_registered(obj.entity_type):
            model_class = registry.get_model_class(obj.entity_type)

            # filter().first() لا يرمي DoesNotExist.
            # لو الـtarget غير موجود، يظل target_instance = None،
            # والـService layer ستتعامل مع حالة عدم وجود الـtarget
            # عند تنفيذ approve/reject.
            target_instance = model_class.objects.filter(
                pk=obj.entity_id
            ).first()

        return AuthorizationPolicy.checker_can_access_scope(
            request.user,
            target_instance=target_instance,
            maker=obj.maker,
        )