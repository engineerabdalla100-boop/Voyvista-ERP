from django.contrib import admin

from .models import Party


@admin.register(Party)
class PartyAdmin(admin.ModelAdmin):
    list_display = ("code", "full_name", "type", "client_category", "is_vip", "record_status")
    list_filter = ("type", "client_category", "is_vip", "record_status")
    search_fields = ("code", "full_name", "phone", "email")