from decimal import Decimal

from django.conf import settings
from django.db import models


class Booking(models.Model):
    class Department(models.TextChoices):
        FLIGHT = "flight", "Flight"
        HOTEL = "hotel", "Hotel"
        VISA = "visa", "Visa"
        CAR = "car", "Car"

    class RecordStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        CANCELLED = "cancelled", "Cancelled"

    class BookingStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"

    class CollectionStatus(models.TextChoices):
        CASH = "cash", "Cash"
        INSTAPAY = "instapay", "InstaPay"
        BANK = "bank", "Bank"
        PARTIAL = "partial", "Partial"

    class ReviewStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        REVIEWED = "reviewed", "Reviewed"

    department = models.CharField(max_length=16, choices=Department.choices)
    status = models.CharField(max_length=16, choices=BookingStatus.choices, default=BookingStatus.PENDING)
    record_status = models.CharField(max_length=16, choices=RecordStatus.choices, default=RecordStatus.ACTIVE)

    date = models.DateField()
    check_out = models.DateField(null=True, blank=True)
    hotel_name = models.CharField(max_length=255, blank=True, default="")
    location = models.CharField(max_length=255, blank=True, default="")
    discount_notice = models.CharField(max_length=255, blank=True, default="")
    ticket_no = models.CharField(max_length=100, blank=True, default="")
    route = models.CharField(max_length=255, blank=True, default="")
    passenger_name = models.CharField(max_length=255)
    customer_name = models.CharField(max_length=255, blank=True, default="")
    file_number = models.CharField(max_length=50, blank=True, default="", db_index=True)
    note = models.TextField(blank=True, default="")

    rate = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    handling = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    net_rate = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    supplier = models.CharField(max_length=255, blank=True, default="")
    selling_rate = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=3, default="EGP")

    collection_status = models.CharField(max_length=16, choices=CollectionStatus.choices, null=True, blank=True)
    paid_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    remaining_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    # Car booking fields (department=car). Left blank on all other
    # departments -- adding them never touches Flights/Hotels/Visas data.
    driver_name = models.CharField(max_length=255, blank=True, default="")
    driver_phone = models.CharField(max_length=50, blank=True, default="")
    car_type = models.CharField(max_length=100, blank=True, default="")
    from_location = models.CharField(max_length=255, blank=True, default="")
    to_location = models.CharField(max_length=255, blank=True, default="")
    passenger_count = models.PositiveIntegerField(null=True, blank=True)

    # Customer identity linking. `customer` is the resolved Party once
    # the typed code matches an existing customer or a PartyAlias.
    # `original_customer_code` is a permanent, unaltered record of
    # exactly what the staff member typed at booking time -- kept even
    # after a later merge links it to a Party, so the audit trail is
    # never lost.
    customer = models.ForeignKey("parties.Party", null=True, blank=True, on_delete=models.SET_NULL, related_name="bookings")
    original_customer_code = models.CharField(max_length=64, blank=True, default="")

    review_status = models.CharField(max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.PENDING)

    class AccountingStatus(models.TextChoices):
        PENDING = "pending", "Pending Accounting Approval"
        LOCKED = "locked", "Approved & Locked"

    accounting_status = models.CharField(max_length=16, choices=AccountingStatus.choices, default=AccountingStatus.PENDING)
    accounting_journal_entry_id = models.IntegerField(null=True, blank=True)
    supplier_cancellation_fee = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    client_cancellation_fee = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_bookings")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="updated_bookings")
    version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def profit(self):
        return self.selling_rate - self.net_rate

    def __str__(self):
        return f"{self.department} - {self.passenger_name}"