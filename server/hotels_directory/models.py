from django.conf import settings
from django.db import models


class Hotel(models.Model):
    """
    Reference directory of hotels -- separate from an actual booking.
    Lets staff search by area (e.g. "Sokhna") and pull up every hotel
    registered there, with its own gallery of photos and multiple
    contact numbers/emails (a hotel often has more than one department
    line).
    """

    class StarRating(models.IntegerChoices):
        ONE = 1, "1 Star"
        TWO = 2, "2 Stars"
        THREE = 3, "3 Stars"
        FOUR = 4, "4 Stars"
        FIVE = 5, "5 Stars"

    name = models.CharField(max_length=255)
    area = models.CharField(max_length=150, db_index=True, help_text="e.g. Sokhna, Hurghada, Sharm El Sheikh.")
    address = models.CharField(max_length=500, blank=True, default="")
    star_rating = models.PositiveSmallIntegerField(choices=StarRating.choices, null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_hotels")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["area", "name"]

    def __str__(self):
        return f"{self.name} ({self.area})"


class HotelPhoto(models.Model):
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="photos")
    photo_data = models.TextField(help_text="Base64 data URL of the photo.")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]


class HotelPhone(models.Model):
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="phones")
    label = models.CharField(max_length=100, blank=True, default="", help_text="e.g. Reservations, Front Desk.")
    number = models.CharField(max_length=50)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.number} ({self.label})" if self.label else self.number


class HotelEmail(models.Model):
    hotel = models.ForeignKey(Hotel, on_delete=models.CASCADE, related_name="emails")
    label = models.CharField(max_length=100, blank=True, default="", help_text="e.g. Reservations, Sales.")
    email = models.EmailField()

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.email} ({self.label})" if self.label else self.email