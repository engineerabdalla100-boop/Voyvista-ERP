from django.contrib import admin

from .models import Broadcast, OwnerFile


@admin.register(Broadcast)
class BroadcastAdmin(admin.ModelAdmin):
    list_display = ("level", "message", "posted_by", "posted_at")


@admin.register(OwnerFile)
class OwnerFileAdmin(admin.ModelAdmin):
    list_display = ("name", "uploaded_by", "uploaded_at")