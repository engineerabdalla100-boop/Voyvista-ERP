from decimal import Decimal

from django.conf import settings
from django.db import models


class Party(models.Model):
    class Type(models.TextChoices):
        CUSTOMER = "customer", "Customer"
        SUPPLIER = "supplier", "Supplier"

    class ClientCategory(models.TextChoices):
        B2B = "b2b", "B2B"
        B2C = "b2c", "B2C"
        SALES_REPORT = "sales_report", "Sales Report Customer"

    class RecordStatus(models.TextChoices):
        ACTIVE = "active", "Active"
        ARCHIVED = "archived", "Archived"

    class Currency(models.TextChoices):
        EGP = "EGP", "EGP"
        USD = "USD", "USD"
        EUR = "EUR", "EUR"
        SAR = "SAR", "SAR"
        KWD = "KWD", "KWD"
        GBP = "GBP", "GBP"
        JPY = "JPY", "JPY"
        CNY = "CNY", "CNY"
        CAD = "CAD", "CAD"

    code = models.CharField(max_length=32, db_index=True, blank=True, default="")
    type = models.CharField(max_length=16, choices=Type.choices)
    client_category = models.CharField(max_length=16, choices=ClientCategory.choices)

    parent_party = models.ForeignKey(
        "self", null=True, blank=True, related_name="sub_members", on_delete=models.PROTECT,
    )
    relationship = models.CharField(max_length=64, blank=True, default="")
    job_title = models.CharField(max_length=120, blank=True, default="")

    full_name = models.CharField(max_length=255)
    industry = models.CharField(max_length=255, blank=True, default="")
    phone = models.CharField(max_length=32, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.CharField(max_length=500, blank=True, default="")

    currency = models.CharField(max_length=3, choices=Currency.choices, default=Currency.EGP)
    credit_limit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    opening_balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    passport_number = models.CharField(max_length=64, blank=True, default="")
    passport_expiry = models.DateField(null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    national_id = models.CharField(max_length=64, blank=True, default="")

    is_vip = models.BooleanField(default=False)
    preferences = models.TextField(blank=True, default="")

    record_status = models.CharField(max_length=16, choices=RecordStatus.choices, default=RecordStatus.ACTIVE)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_parties")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code", "full_name"]
        indexes = [
            models.Index(fields=["code"]),
            models.Index(fields=["type"]),
            models.Index(fields=["client_category"]),
        ]
        constraints = [
            models.UniqueConstraint(fields=["code"], condition=models.Q(parent_party__isnull=True), name="unique_root_party_code"),
        ]

    def save(self, *args, **kwargs):
        # Auto-generate a code the first time this Party is saved.
        # Manual codes are still allowed (passed in explicitly); this
        # only fires when nothing was supplied.
        #
        # Three independent numbering schemes, chosen by client_category:
        #   - B2B root account (company, no parent):   VOY-B01-0001
        #   - B2B sub-member (employee under a company): VOY-B01-0002, -0003...
        #   - B2C root account (family, no parent):     VOY-C01-0001
        #   - B2C sub-member (family member):            VOY-C01-0002, -0003...
        #   - anything else (walk-in / sales_report):    VOY-0000001 (unchanged)
        if not self.code:
            if self.client_category in (Party.ClientCategory.B2B, Party.ClientCategory.B2C):
                prefix_letter = "B" if self.client_category == Party.ClientCategory.B2B else "C"
                if self.parent_party_id:
                    # Sub-member: continue the sequence under the same root.
                    root = self.parent_party
                    root_code = root.code.split("-")
                    root_label = root_code[1] if len(root_code) > 1 else f"{prefix_letter}01"
                    last_sibling = Party.objects.filter(parent_party_id=self.parent_party_id).exclude(code="").order_by("-id").first()
                    next_sub = 1
                    if last_sibling and "-" in last_sibling.code:
                        try:
                            next_sub = int(last_sibling.code.split("-")[-1]) + 1
                        except ValueError:
                            next_sub = Party.objects.filter(parent_party_id=self.parent_party_id).count() + 2
                    else:
                        next_sub = 2
                    self.code = f"VOY-{root_label}-{next_sub:04d}"
                else:
                    # New root account: next company/family number for this category.
                    last_root = (
                        Party.objects.filter(client_category=self.client_category, parent_party__isnull=True)
                        .exclude(code="").order_by("-id").first()
                    )
                    next_root = 1
                    if last_root and "-" in last_root.code:
                        try:
                            next_root = int(last_root.code.split("-")[1].lstrip(prefix_letter)) + 1
                        except (ValueError, IndexError):
                            next_root = Party.objects.filter(client_category=self.client_category, parent_party__isnull=True).count() + 1
                    else:
                        next_root = Party.objects.filter(client_category=self.client_category, parent_party__isnull=True).count() + 1
                    self.code = f"VOY-{prefix_letter}{next_root:02d}-0001"
            else:
                last = Party.objects.filter(client_category=Party.ClientCategory.SALES_REPORT).exclude(code="").order_by("-id").first()
                next_number = 1
                if last and last.code.startswith("VOY-") and "-" not in last.code[4:]:
                    try:
                        next_number = int(last.code.split("VOY-")[1]) + 1
                    except (ValueError, IndexError):
                        next_number = Party.objects.filter(client_category=Party.ClientCategory.SALES_REPORT).count() + 1
                else:
                    next_number = Party.objects.filter(client_category=Party.ClientCategory.SALES_REPORT).count() + 1
                self.code = f"VOY-{next_number:07d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} - {self.full_name}"

class PartyContactNumber(models.Model):
    party = models.ForeignKey(Party, on_delete=models.CASCADE, related_name="contact_numbers")
    number = models.CharField(max_length=32)
    label = models.CharField(max_length=64, blank=True, default="")

    def __str__(self):
        return f"{self.party.full_name} - {self.number}"


class PartySocialLink(models.Model):
    party = models.ForeignKey(Party, on_delete=models.CASCADE, related_name="social_links")
    platform = models.CharField(max_length=64)
    handle_or_url = models.CharField(max_length=500)

    def __str__(self):
        return f"{self.party.full_name} - {self.platform}"


class PartyAlias(models.Model):
    """
    A free-text customer code from an old booking that was later
    identified as the same real person/company as an existing Party.
    Merging never rewrites the original booking's stored code --
    Booking.original_customer_code stays exactly as first typed, so the
    audit trail is never lost. This table is only the lookup: "if
    someone searches/types this old code, resolve it to this Party."
    """

    party = models.ForeignKey(Party, on_delete=models.CASCADE, related_name="aliases")
    alias_code = models.CharField(max_length=64, db_index=True, unique=True)
    note = models.CharField(max_length=255, blank=True, default="")

    linked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="linked_party_aliases")
    linked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-linked_at"]

    def __str__(self):
        return f"{self.alias_code} -> {self.party.code}"
