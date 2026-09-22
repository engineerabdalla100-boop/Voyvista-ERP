from rest_framework import serializers

from .models import StaffMember

MAX_PHOTO_BYTES = 700 * 1024
PHOTO_FIELDS = ["profile_photo", "id_front_photo", "id_back_photo", "criminal_record_photo"]


class StaffMemberSerializer(serializers.ModelSerializer):
    is_active = serializers.BooleanField(read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = StaffMember
        fields = [
            "id", "name", "position", "phone", "email", "start_date", "end_date",
            "notes", "profile_photo", "id_front_photo", "id_back_photo", "criminal_record_photo",
            "is_active", "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if end_date and start_date and end_date < start_date:
            raise serializers.ValidationError({"end_date": "End date cannot be before start date."})

        for field in PHOTO_FIELDS:
            value = attrs.get(field)
            if not value:
                continue
            approx_bytes = len(value) * 3 / 4
            if approx_bytes > MAX_PHOTO_BYTES:
                raise serializers.ValidationError({field: f"Photo is too large (max {MAX_PHOTO_BYTES // 1024}KB)."})
        return attrs