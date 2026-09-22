from django.contrib import admin

from .models import Account


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "type", "nature", "balance", "status")
    list_filter = ("type", "status")
    search_fields = ("code", "name")