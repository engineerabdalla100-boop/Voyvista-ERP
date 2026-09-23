from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import serializers

from .models import User

ONLINE_THRESHOLD_SECONDS = 5 * 60


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = authenticate(username=attrs["username"], password=attrs["password"])
        if not user:
            raise serializers.ValidationError("Invalid username or password.")
        if not user.is_active or not user.is_active_employee:
            raise serializers.ValidationError("This account is disabled.")
        attrs["user"] = user
        return attrs


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name",
            "phone", "role", "is_active_employee", "allowed_modules", "date_joined",
        ]
        read_only_fields = ["id", "date_joined"]


class MeSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "full_name",
            "phone", "role", "department", "is_active_employee", "date_joined",
        ]
        read_only_fields = ["id", "username", "email", "role", "department", "is_active_employee", "date_joined"]

    def get_full_name(self, obj):
        full = (obj.first_name + " " + obj.last_name).strip()
        return full or obj.username


class EmployeeSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    password = serializers.CharField(write_only=True, required=False, min_length=6)
    is_online = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "email", "first_name", "last_name", "full_name",
            "password", "phone", "role", "department", "notes", "allowed_modules",
            "is_active_employee", "last_seen", "is_online", "date_joined",
        ]
        read_only_fields = ["id", "last_seen", "date_joined"]

    def get_full_name(self, obj):
        full = f"{obj.first_name} {obj.last_name}".strip()
        return full or obj.username

    def get_is_online(self, obj):
        if not obj.last_seen:
            return False
        return (timezone.now() - obj.last_seen).total_seconds() < ONLINE_THRESHOLD_SECONDS

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        if not password:
            raise serializers.ValidationError({"password": "Password is required to create an account."})
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance
