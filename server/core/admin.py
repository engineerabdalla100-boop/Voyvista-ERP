from django.contrib import admin

from .base_models import Account, AuditLog, ChangeRequest

@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "account_type", "parent", "is_active", "opening_balance")
    list_filter = ("account_type", "is_active")
    search_fields = ("code", "name")


@admin.register(ChangeRequest)
class ChangeRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "entity_type", "entity_id", "status", "maker", "checker", "requested_at")
    list_filter = ("entity_type", "status")
    readonly_fields = [f.name for f in ChangeRequest._meta.fields]

    def has_add_permission(self, request):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("event_type", "actor", "entity_type", "entity_id", "ip_address", "created_at")
    list_filter = ("event_type",)
    search_fields = ("entity_type", "entity_id", "description")
    readonly_fields = [f.name for f in AuditLog._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False