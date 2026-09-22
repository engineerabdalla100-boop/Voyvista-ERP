from decimal import Decimal

from django.conf import settings
from django.db import models


class Car(models.Model):
    class Category(models.TextChoices):
        ECONOMY = "economy", "Economy"
        LUXURY = "luxury", "Luxury"
        BUS = "bus", "Bus"
        VAN = "van", "Van"

    category = models.CharField(max_length=16, choices=Category.choices)
    type = models.CharField(max_length=255)
    driver_name = models.CharField(max_length=255)
    driver_phone = models.CharField(max_length=32, blank=True, default="")

    price = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    issue_date = models.DateField(null=True, blank=True)
    return_date = models.DateField(null=True, blank=True)

    net = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    sale = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_cars")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def profit(self):
        return self.sale - self.net

    def __str__(self):
        return f"{self.type} - {self.driver_name}"


class CarMovement(models.Model):
    car = models.ForeignKey(Car, on_delete=models.PROTECT, related_name="movements")
    from_location = models.CharField(max_length=255)
    to_location = models.CharField(max_length=255)
    date = models.DateField()
    net = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    selling = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_car_movements")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def profit(self):
        return self.selling - self.net

    def __str__(self):
        return f"{self.from_location} -> {self.to_location} ({self.date})"