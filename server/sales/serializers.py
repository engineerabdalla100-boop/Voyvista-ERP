from rest_framework import serializers

from .models import CommunicationLogEntry, CustomerNote, Quote, Sale, SalesSettings


def _generate_sale_code():
    existing_codes = Sale.objects.values_list("code", flat=True)
    max_num = 0
    for code in existing_codes:
        digits = "".join(ch for ch in code if ch.isdigit())
        if digits:
            max_num = max(max_num, int(digits))
    return f"BK-{max_num + 1:06d}"


class SaleSerializer(serializers.ModelSerializer):
    profit = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Sale
        fields = [
            "id", "code", "department", "client_name", "service",
            "cost", "selling", "profit", "currency", "payment_status", "date",
            "record_status", "cancelled_by", "cancelled_at",
            "created_by", "created_by_name", "version", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "code", "record_status", "cancelled_by", "cancelled_at",
            "created_by", "version", "created_at", "updated_at",
        ]

    def create(self, validated_data):
        validated_data["code"] = _generate_sale_code()
        return super().create(validated_data)

    def validate(self, attrs):
        for field in ("cost", "selling"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Value cannot be negative."})
        return attrs


class QuoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Quote
        fields = ["id", "client", "service", "price", "currency", "valid_until", "created_by", "created_by_name", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]


class CustomerNoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = CustomerNote
        fields = ["id", "client", "note", "created_by", "created_by_name", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]


class CommunicationLogEntrySerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = CommunicationLogEntry
        fields = ["id", "client", "channel", "summary", "created_by", "created_by_name", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]


class SalesSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalesSettings
        fields = ["default_commission", "currency"]