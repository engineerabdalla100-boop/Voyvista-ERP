from rest_framework import serializers

from .models import Car, CarMovement


class CarMovementSerializer(serializers.ModelSerializer):
    profit = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = CarMovement
        fields = [
            "id", "car", "from_location", "to_location", "date",
            "net", "selling", "profit", "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = ["id", "created_by", "created_at"]

    def validate(self, attrs):
        for field in ("net", "selling"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Value cannot be negative."})
        return attrs


class CarSerializer(serializers.ModelSerializer):
    profit = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    movements_count = serializers.SerializerMethodField()
    total_movements_profit = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Car
        fields = [
            "id", "category", "type", "driver_name", "driver_phone",
            "price", "issue_date", "return_date", "net", "sale", "profit",
            "movements_count", "total_movements_profit",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_movements_count(self, obj):
        return obj.movements.count()

    def get_total_movements_profit(self, obj):
        return sum((m.profit for m in obj.movements.all()), start=0)

    def validate(self, attrs):
        for field in ("price", "net", "sale"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Value cannot be negative."})
        return attrs