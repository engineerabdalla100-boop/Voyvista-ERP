from django.contrib import admin

from .models import Event, EventCompany, EventTeamMember, ExpenseItem


class ExpenseItemInline(admin.TabularInline):
    model = ExpenseItem
    extra = 0


class EventCompanyInline(admin.TabularInline):
    model = EventCompany
    extra = 0


class EventTeamMemberInline(admin.TabularInline):
    model = EventTeamMember
    extra = 0


@admin.register(Event)
class EventAdmin(admin.ModelAdmin):
    list_display = ("location", "date", "people_count", "created_by", "created_at")
    search_fields = ("location",)
    inlines = [ExpenseItemInline, EventCompanyInline, EventTeamMemberInline]