from django.contrib import admin

from .models import Car, CarMovement


@admin.register(Car)
class CarAdmin(admin.ModelAdmin):
    list_display = ("type", "driver_name", "created_by", "created_at")
    search_fields = ("type", "driver_name")


@admin.register(CarMovement)
class CarMovementAdmin(admin.ModelAdmin):
    list_display = ("car", "from_location", "to_location", "date", "net", "selling")
    list_filter = ("date",)