from rest_framework import serializers

from .models import Hotel, HotelEmail, HotelPhone, HotelPhoto


class HotelPhoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = HotelPhone
        fields = ["id", "label", "number"]


class HotelEmailSerializer(serializers.ModelSerializer):
    class Meta:
        model = HotelEmail
        fields = ["id", "label", "email"]


class HotelPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = HotelPhoto
        fields = ["id", "photo_data", "sort_order"]


class HotelSerializer(serializers.ModelSerializer):
    phones = HotelPhoneSerializer(many=True, required=False)
    emails = HotelEmailSerializer(many=True, required=False)
    photos = HotelPhotoSerializer(many=True, required=False)
    star_rating_display = serializers.CharField(source="get_star_rating_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Hotel
        fields = [
            "id", "name", "area", "address", "star_rating", "star_rating_display", "notes", "is_active",
            "phones", "emails", "photos", "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def create(self, validated_data):
        phones_data = validated_data.pop("phones", [])
        emails_data = validated_data.pop("emails", [])
        photos_data = validated_data.pop("photos", [])
        hotel = Hotel.objects.create(**validated_data)
        for phone in phones_data:
            HotelPhone.objects.create(hotel=hotel, **phone)
        for email in emails_data:
            HotelEmail.objects.create(hotel=hotel, **email)
        for idx, photo in enumerate(photos_data):
            HotelPhoto.objects.create(hotel=hotel, sort_order=photo.get("sort_order", idx), photo_data=photo["photo_data"])
        return hotel

    def update(self, instance, validated_data):
        phones_data = validated_data.pop("phones", None)
        emails_data = validated_data.pop("emails", None)
        photos_data = validated_data.pop("photos", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if phones_data is not None:
            instance.phones.all().delete()
            for phone in phones_data:
                HotelPhone.objects.create(hotel=instance, **phone)

        if emails_data is not None:
            instance.emails.all().delete()
            for email in emails_data:
                HotelEmail.objects.create(hotel=instance, **email)

        if photos_data is not None:
            instance.photos.all().delete()
            for idx, photo in enumerate(photos_data):
                HotelPhoto.objects.create(hotel=instance, sort_order=photo.get("sort_order", idx), photo_data=photo["photo_data"])

        return instance