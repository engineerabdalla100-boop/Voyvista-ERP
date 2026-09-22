from django.contrib import admin
from .models import Company

@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ('name', 'company_type', 'contact_phone', 'is_active')
    list_filter = ('company_type', 'is_active')
    search_fields = ('name', 'tax_number')
