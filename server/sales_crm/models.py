from decimal import Decimal

from django.conf import settings
from django.db import models


class Deal(models.Model):
    """
    A B2B sales opportunity moving through a fixed pipeline. When it
    reaches WON, a real Booking is created automatically (see
    views.DealViewSet.move_stage) so the deal flows straight into
    the same accounting approval process every other department uses --
    no separate "sales bookings" table, no parallel accounting path.
    """

    class Stage(models.TextChoices):
        STAGE1 = "stage1", "New Target"
        STAGE2 = "stage2", "In Contact"
        STAGE3 = "stage3", "Quote/Negotiation"
        STAGE4 = "stage4", "Won"
        STAGE5 = "stage5", "Lost"

    company_name = models.CharField(max_length=255)
    contact_name = models.CharField(max_length=255, blank=True, default="")
    contact_phone = models.CharField(max_length=50, blank=True, default="")
    contact_email = models.EmailField(blank=True, default="")
    service_type = models.CharField(max_length=255, blank=True, default="")
    estimated_value = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    stage = models.CharField(max_length=16, choices=Stage.choices, default=Stage.STAGE1, db_index=True)

    # Links this deal to the Party it represents (created automatically
    # the first time the deal is saved, or set manually if it matches
    # an existing customer) so it plugs into the same customer-code
    # system every booking uses -- not a separate company directory.
    party = models.ForeignKey("parties.Party", null=True, blank=True, on_delete=models.SET_NULL, related_name="deals")

    # Set once, the moment the deal is moved to Won -- the Booking this
    # deal turned into. Left null for every other stage.
    booking = models.ForeignKey("bookings.Booking", null=True, blank=True, on_delete=models.SET_NULL, related_name="source_deal")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_deals")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["stage"]),
        ]

    def __str__(self):
        return f"{self.company_name} ({self.get_stage_display()})"


class Activity(models.Model):
    """
    One logged touchpoint with a deal -- a call, WhatsApp message, email,
    or visit -- with an optional follow-up reminder. Purely a CRM log;
    it never affects accounting or the deal's stage on its own.
    """

    class ActivityType(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        CALL = "call", "Phone Call"
        EMAIL = "email", "Email"
        VISIT = "visit", "Field Visit"

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="activities")
    activity_type = models.CharField(max_length=16, choices=ActivityType.choices)
    note = models.TextField()
    reminder_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="logged_activities")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.deal.company_name} -- {self.get_activity_type_display()}"