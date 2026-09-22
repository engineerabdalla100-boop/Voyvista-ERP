from decimal import Decimal

from django.conf import settings
from django.db import models


class Sale(models.Model):
    class Department(models.TextChoices):
        FLIGHTS = "flights", "Flights"
        HOTELS = "hotels", "Hotels"
        PACKAGES = "packages", "Packages"
        VISAS = "visas", "Visas"
        TRANSFERS = "transfers", "Transfers"
        INSURANCE = "insurance", "Insurance"

    class PaymentStatus(models.TextChoices):
        PAID_FULL = "paid_full", "Paid in Full"
        DEPOSIT = "deposit", "Deposit"
        UNPAID = "unpaid", "Unpaid"

    class Currency(models.TextChoices):
        EGP = "EGP", "EGP"
        USD = "USD", "USD"
        EUR = "EUR", "EUR"
        KWD = "KWD", "KWD"
        CAD = "CAD", "CAD"
        CNY = "CNY", "CNY"
        JPY = "JPY", "JPY"

    class RecordStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        CANCELLED = "cancelled", "Cancelled"

    code = models.CharField(max_length=32, unique=True, blank=True)
    department = models.CharField(max_length=16, choices=Department.choices)
    client_name = models.CharField(max_length=255)
    service = models.CharField(max_length=255, blank=True, default="")

    cost = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    selling = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.EGP)
    payment_status = models.CharField(max_length=16, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID)

    date = models.DateField()

    record_status = models.CharField(max_length=16, choices=RecordStatus.choices, default=RecordStatus.ACTIVE)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="cancelled_sales",
        null=True, blank=True,
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_sales")
    version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        indexes = [
            models.Index(fields=["department"]),
            models.Index(fields=["payment_status"]),
            models.Index(fields=["client_name"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            self.version += 1
        super().save(*args, **kwargs)

    @property
    def profit(self):
        return self.selling - self.cost

    def __str__(self):
        return f"{self.code} - {self.client_name}"


class Quote(models.Model):
    client = models.CharField(max_length=255)
    service = models.CharField(max_length=255)
    price = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, choices=Sale.Currency.choices, default=Sale.Currency.EGP)
    valid_until = models.DateField(null=True, blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_quotes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.client} - {self.service}"


class CustomerNote(models.Model):
    client = models.CharField(max_length=255)
    note = models.TextField()

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="customer_notes")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.client} - {self.created_at:%Y-%m-%d}"


class CommunicationLogEntry(models.Model):
    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        PHONE = "phone", "Phone Call"
        EMAIL = "email", "Email"

    client = models.CharField(max_length=255)
    channel = models.CharField(max_length=16, choices=Channel.choices)
    summary = models.TextField()

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="communication_logs")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.client} - {self.get_channel_display()}"


class SalesSettings(models.Model):
    default_commission = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("15"))
    currency = models.CharField(max_length=3, choices=Sale.Currency.choices, default=Sale.Currency.EGP)

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        pass

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Sales Settings"