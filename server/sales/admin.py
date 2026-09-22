from django.contrib import admin

from .models import CommunicationLogEntry, CustomerNote, Quote, Sale, SalesSettings


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ("code", "department", "client_name", "currency", "selling", "payment_status", "record_status", "date")
    list_filter = ("department", "payment_status", "record_status", "currency")
    search_fields = ("code", "client_name")


@admin.register(Quote)
class QuoteAdmin(admin.ModelAdmin):
    list_display = ("client", "service", "price", "currency", "valid_until")


@admin.register(CustomerNote)
class CustomerNoteAdmin(admin.ModelAdmin):
    list_display = ("client", "created_by", "created_at")


@admin.register(CommunicationLogEntry)
class CommunicationLogEntryAdmin(admin.ModelAdmin):
    list_display = ("client", "channel", "created_by", "created_at")


@admin.register(SalesSettings)
class SalesSettingsAdmin(admin.ModelAdmin):
    list_display = ("default_commission", "currency")

    def has_add_permission(self, request):
        return not SalesSettings.objects.exists()