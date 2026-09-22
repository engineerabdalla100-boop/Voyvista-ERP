from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "email", "role", "department", "is_active_employee", "is_staff")
    list_filter = ("role", "department", "is_active_employee", "is_staff", "is_superuser")
    search_fields = ("username", "email", "phone")
    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "ERP Details",
            {
                "fields": (
                    "role",
                    "phone",
                    "department",
                    "notes",
                    "allowed_modules",
                    "is_active_employee",
                    "deactivated_at",
                )
            },
        ),
    )