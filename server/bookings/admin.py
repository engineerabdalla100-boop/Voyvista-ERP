from django.contrib import admin

from .models import Booking


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("department", "date", "ticket_no", "customer_name", "currency", "selling_rate", "collection_status", "review_status")
    list_filter = ("department", "collection_status", "review_status", "currency")
    search_fields = ("ticket_no", "customer_name", "file_number")