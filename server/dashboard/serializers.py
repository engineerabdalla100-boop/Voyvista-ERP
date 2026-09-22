from rest_framework import serializers

from .models import Broadcast, CompanySettings, OwnerFile


class BroadcastSerializer(serializers.ModelSerializer):
    posted_by_name = serializers.CharField(source="posted_by.username", read_only=True)

    class Meta:
        model = Broadcast
        fields = ["level", "message", "posted_by", "posted_by_name", "posted_at"]
        read_only_fields = ["posted_by", "posted_at"]


class OwnerFileSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source="uploaded_by.username", read_only=True)

    class Meta:
        model = OwnerFile
        fields = ["id", "name", "file", "uploaded_by", "uploaded_by_name", "uploaded_at"]
        read_only_fields = ["id", "uploaded_by", "uploaded_at"]


class CompanySettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanySettings
        fields = ["logo", "updated_by", "updated_at"]
        read_only_fields = ["updated_by", "updated_at"]