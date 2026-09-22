from django.contrib import admin

from .models import Guide


@admin.register(Guide)
class GuideAdmin(admin.ModelAdmin):
    list_display = ("name", "language", "phone", "created_by", "created_at")
    search_fields = ("name", "language")