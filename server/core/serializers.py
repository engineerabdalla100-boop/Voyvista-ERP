from rest_framework import serializers

from .base_models import Account, ChangeRequest

class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = ["id", "code", "name", "account_type", "parent", "is_active", "opening_balance", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        instance = self.instance
        if instance and "opening_balance" in attrs and attrs["opening_balance"] != instance.opening_balance:
            has_history = ChangeRequest.objects.filter(
                entity_type="account", entity_id=str(instance.id), status=ChangeRequest.Status.APPROVED,
            ).exclude(pk=self.instance.pk if hasattr(self.instance, "pk") else None).exists()
            if has_history:
                raise serializers.ValidationError(
                    "لا يمكن تعديل الرصيد الافتتاحي — يوجد حركات معتمدة على هذا الحساب بالفعل."
                )
        return attrs


class ChangeRequestSerializer(serializers.ModelSerializer):
    maker_name = serializers.CharField(source="maker.username", read_only=True)
    checker_name = serializers.CharField(source="checker.username", read_only=True, default=None)

    class Meta:
        model = ChangeRequest
        fields = [
            "id", "entity_type", "entity_id", "proposed_data", "status",
            "maker", "maker_name", "checker", "checker_name",
            "rejection_reason", "apply_failure_reason", "requested_at", "reviewed_at",
        ]
        read_only_fields = fields


class RejectChangeRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")