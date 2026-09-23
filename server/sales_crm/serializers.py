from rest_framework import serializers

from .models import Activity, Deal


class ActivitySerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Activity
        fields = ["id", "deal", "activity_type", "note", "reminder_at", "created_by", "created_by_name", "created_at"]
        read_only_fields = ["id", "created_by", "created_at"]


class DealSerializer(serializers.ModelSerializer):
    party_code = serializers.CharField(source="party.code", read_only=True)
    booking_id = serializers.IntegerField(source="booking.id", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Deal
        fields = [
            "id", "company_name", "contact_name", "contact_phone", "contact_email",
            "service_type", "estimated_value", "stage",
            "party", "party_code", "booking", "booking_id",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "party", "booking", "created_by", "created_at", "updated_at"]