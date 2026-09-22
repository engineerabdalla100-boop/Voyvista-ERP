from rest_framework import serializers

from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    profit = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)
    updated_by_name = serializers.CharField(source="updated_by.username", read_only=True)
    customer_code = serializers.CharField(source="customer.code", read_only=True, default=None)

    class Meta:
        model = Booking
        fields = [
            "id", "department", "status", "record_status", "accounting_status",
            "date", "check_out", "hotel_name", "location", "discount_notice",
            "ticket_no", "route", "passenger_name", "customer_name",
            "file_number", "note",
            "rate", "handling", "net_rate", "supplier", "selling_rate", "currency", "profit",
            "collection_status", "paid_amount", "remaining_amount",
            "review_status",
            "driver_name", "driver_phone", "car_type", "from_location", "to_location", "passenger_count",
            "customer", "customer_code", "original_customer_code",
            "created_by", "created_by_name", "updated_by", "updated_by_name", "version", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "updated_by", "version", "created_at", "updated_at"]

    def validate(self, attrs):
        for field in ("rate", "handling", "net_rate", "selling_rate", "paid_amount"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Value cannot be negative."})

        collection_status = attrs.get("collection_status", getattr(self.instance, "collection_status", None))
        selling_rate = attrs.get("selling_rate", getattr(self.instance, "selling_rate", 0))
        paid_amount = attrs.get("paid_amount", getattr(self.instance, "paid_amount", 0))

        if collection_status == Booking.CollectionStatus.PARTIAL:
            if paid_amount is None or paid_amount <= 0:
                raise serializers.ValidationError({"paid_amount": "Required and must be greater than zero for partial payment."})
            if paid_amount > selling_rate:
                raise serializers.ValidationError({"paid_amount": "Paid amount cannot exceed the selling rate."})
            attrs["remaining_amount"] = selling_rate - paid_amount
        elif collection_status in (Booking.CollectionStatus.CASH, Booking.CollectionStatus.INSTAPAY, Booking.CollectionStatus.BANK):
            attrs["paid_amount"] = selling_rate
            attrs["remaining_amount"] = 0
        return attrs

    def create(self, validated_data):
        # If the booking wasn't linked to an existing customer (no
        # Party picked, no code that resolved to one), auto-create a
        # new Party for whatever name was typed -- it gets its own
        # unified VV-CUS-000001 code for free via Party.save(), so the
        # customer always ends up identifiable even when staff never
        # touched the customer picker at all.
        if not validated_data.get("customer"):
            from parties.models import Party

            name = validated_data.get("customer_name") or validated_data.get("passenger_name")
            if name:
                new_party = Party.objects.create(
                    type=Party.Type.CUSTOMER,
                    client_category=Party.ClientCategory.SALES_REPORT,
                    full_name=name,
                    created_by=self.context["request"].user,
                )
                validated_data["customer"] = new_party

        return super().create(validated_data)