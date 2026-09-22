from django.db import models

class Company(models.Model):
    COMPANY_TYPES = (('CLIENT', 'Client / Agency'), ('SUPPLIER', 'Hotel / Transport Supplier'), ('BOTH', 'Both'))
    name = models.CharField(max_length=255, unique=True)
    company_type = models.CharField(max_length=20, choices=COMPANY_TYPES, default='CLIENT')
    contact_email = models.EmailField(blank=True, null=True)
    contact_phone = models.CharField(max_length=20, blank=True, null=True)
    tax_number = models.CharField(max_length=50, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'Companies'

    def __str__(self):
        return f'{self.name} ({self.company_type})'
