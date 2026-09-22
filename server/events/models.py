from decimal import Decimal

from django.conf import settings
from django.db import models


class Event(models.Model):
    location = models.CharField(max_length=255)
    date = models.DateField()
    people_count = models.PositiveIntegerField(default=0)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_events")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def total_spent(self):
        return sum((item.amount for item in self.expense_items.all()), start=Decimal("0"))

    def __str__(self):
        return f"{self.location} ({self.date})"


class ExpenseItem(models.Model):
    class Category(models.TextChoices):
        PURCHASE = "purchase", "Purchase"
        RENTAL = "rental", "Rental"

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="expense_items")
    description = models.CharField(max_length=500)
    category = models.CharField(max_length=16, choices=Category.choices)
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    def __str__(self):
        return f"{self.description} ({self.amount})"


class EventCompany(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="companies")
    name = models.CharField(max_length=255)

    def __str__(self):
        return self.name


class EventTeamMember(models.Model):
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="team")
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=255, blank=True, default="")

    def __str__(self):
        return f"{self.name} - {self.role or 'No role specified'}"