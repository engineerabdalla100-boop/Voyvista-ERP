from decimal import Decimal

from django.conf import settings
from django.db import models


class Account(models.Model):
    class AccountType(models.TextChoices):
        ASSET = "asset", "Asset"
        LIABILITY = "liability", "Liability"
        EQUITY = "equity", "Equity"
        REVENUE = "revenue", "Revenue"
        EXPENSE = "expense", "Expense"

    class Nature(models.TextChoices):
        DEBIT = "debit", "Debit"
        CREDIT = "credit", "Credit"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        POSTABLE = "postable", "Postable"

    parent = models.ForeignKey("self", null=True, blank=True, related_name="children", on_delete=models.PROTECT)
    code = models.CharField(max_length=32, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=16, choices=AccountType.choices)
    nature = models.CharField(max_length=8, choices=Nature.choices)
    currency = models.CharField(max_length=3, default="EGP")
    opening_balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    balance = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    is_system_account = models.BooleanField(default=False)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_accounts")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]
        indexes = [models.Index(fields=["type"]), models.Index(fields=["parent"])]

    def has_movements(self):
        return self.journal_lines.exists()

    def __str__(self):
        return f"{self.code} - {self.name}"


class JournalEntry(models.Model):
    """
    Real double-entry journal. A save is only valid once total_debit ==
    total_credit across all lines -- enforced in the serializer, not
    here, so the exact same rule can be re-checked at apply-time too.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        POSTED = "posted", "Posted"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    date = models.DateField()
    reference = models.CharField(max_length=255, blank=True, default="")
    description = models.CharField(max_length=500)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)

    reverses = models.OneToOneField("self", null=True, blank=True, related_name="reversed_by", on_delete=models.PROTECT)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_journal_entries")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name_plural = "Journal Entries"

    @property
    def total_debit(self):
        return sum((line.debit for line in self.lines.all()), start=Decimal("0"))

    @property
    def total_credit(self):
        return sum((line.credit for line in self.lines.all()), start=Decimal("0"))

    def __str__(self):
        return f"{self.number} - {self.description}"


class JournalLine(models.Model):
    entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="lines")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="journal_lines")
    debit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    credit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    memo = models.CharField(max_length=255, blank=True, default="")
    cost_center = models.CharField(max_length=100, blank=True, default="")

    def __str__(self):
        return f"{self.account.code} - D:{self.debit} C:{self.credit}"

class EmployeeName(models.Model):
    """
    A free-text name for payroll/custody -- deliberately NOT linked to
    the User model, since most people paid through custody (drivers,
    guides, field staff) never need a login account. Added and removed
    freely from the UI; kept from month to month so a name typed once
    doesn't need retyping every payroll run.
    """

    name = models.CharField(max_length=255, unique=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_employee_names")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Custody(models.Model):
    """
    An employee's cash advance. Amount is debited from the given
    treasury account and credited to a per-employee custody account the
    moment it's posted -- the reverse of an expense. spent tracks how
    much of it has been consumed by posted ExpenseVouchers charged
    against it (kept as a running total for a fast "remaining" lookup,
    never the source of truth -- the sum of linked vouchers always is).
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        POSTED = "posted", "Posted (Open)"
        SETTLED = "settled", "Settled (Closed)"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    date = models.DateField()
    employee_name = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    spent = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    treasury_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="custody_issuances")
    custody_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="custody_holdings")
    description = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    journal_entry = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name="custody_source")
    settlement_entry = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name="custody_settlement")

    currency = models.CharField(max_length=3, default="EGP")
    due_date = models.DateField(null=True, blank=True, help_text="Deadline by which this custody must be settled.")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_custody_records")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-id"]
        verbose_name_plural = "Custody Records"

    @property
    def remaining(self):
        return self.amount - self.spent

    def __str__(self):
        return f"{self.number} - {self.employee.username} - {self.amount}"


class ExpenseVoucher(models.Model):
    class PaymentMethod(models.TextChoices):
        CASH = "cash", "Cash"
        BANK = "bank", "Bank"
        CUSTODY = "custody", "Custody"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        POSTED = "posted", "Posted"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    date = models.DateField()
    category = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    payment_method = models.CharField(max_length=16, choices=PaymentMethod.choices)
    treasury_account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="expenses_paid")
    custody = models.ForeignKey(Custody, null=True, blank=True, on_delete=models.PROTECT, related_name="expenses_charged")
    expense_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="expenses_booked")
    invoice_number = models.CharField(max_length=100, blank=True, default="")
    description = models.CharField(max_length=500)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    reverses = models.OneToOneField("self", null=True, blank=True, related_name="reversed_by", on_delete=models.PROTECT)
    journal_entry = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name="expense_source")

    currency = models.CharField(max_length=3, default="EGP")
    exchange_rate = models.DecimalField(max_digits=12, decimal_places=4, default=Decimal("1"))
    booking_reference = models.CharField(max_length=100, blank=True, default="")
    vat_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    vat_account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="expense_vat_entries")
    attachment_name = models.CharField(max_length=255, blank=True, default="")
    attachment_data = models.TextField(blank=True, default="", help_text="Base64 data URL of the uploaded receipt/invoice image.")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_expenses")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.number} - {self.category} - {self.amount}"


class Voucher(models.Model):
    """
    Receipt (from a customer) or Payment (to a supplier). Touches two
    places at once -- the Treasury account and the Party's own running
    balance (on the existing parties.Party model, not a separate
    accounting-only customer/supplier record) -- so posting must be
    fully atomic across both.
    """

    class VoucherType(models.TextChoices):
        RECEIPT = "receipt", "Receipt"
        PAYMENT = "payment", "Payment"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        POSTED = "posted", "Posted"

    class PaymentMethod(models.TextChoices):
        CASH = "cash", "Cash"
        INSTAPAY = "instapay", "InstaPay"
        BANK_TRANSFER = "bank_transfer", "Bank Transfer"
        CHEQUE = "cheque", "Cheque"
        CARD = "card", "Card"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    type = models.CharField(max_length=8, choices=VoucherType.choices)
    date = models.DateField()
    party = models.ForeignKey("parties.Party", on_delete=models.PROTECT, related_name="vouchers")
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    treasury_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="vouchers")
    party_control_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="party_vouchers", help_text="AR or AP control account this voucher posts against.")
    description = models.CharField(max_length=500)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    reverses = models.OneToOneField("self", null=True, blank=True, related_name="reversed_by", on_delete=models.PROTECT)
    journal_entry = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name="voucher_source")

    payment_method = models.CharField(max_length=16, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    currency = models.CharField(max_length=3, default="EGP")
    exchange_rate = models.DecimalField(max_digits=12, decimal_places=4, default=Decimal("1"))
    booking = models.ForeignKey("bookings.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="vouchers")
    booking_reference = models.CharField(max_length=100, blank=True, default="")
    transaction_reference = models.CharField(max_length=100, blank=True, default="")
    attachment_name = models.CharField(max_length=255, blank=True, default="")
    attachment_data = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_vouchers")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.number} - {self.party.full_name} - {self.amount}"


class Invoice(models.Model):
    """
    Official invoice. Once is_issued=True, amount/party/lines are locked
    forever -- the only way to correct an issued invoice is a Credit
    Note (a new negative-amount Invoice referencing this one via
    credits) followed by a brand-new replacement Invoice, never an edit.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ISSUED = "issued", "Issued"
        CREDITED = "credited", "Credited (Cancelled by Credit Note)"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    date = models.DateField()
    party = models.ForeignKey("parties.Party", on_delete=models.PROTECT, related_name="invoices")
    booking = models.ForeignKey("bookings.Booking", on_delete=models.SET_NULL, null=True, blank=True, related_name="invoices")
    booking_reference = models.CharField(max_length=100, blank=True, default="")
    total_amount = models.DecimalField(max_digits=18, decimal_places=2)
    description = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)

    is_issued = models.BooleanField(default=False)
    issued_at = models.DateTimeField(null=True, blank=True)
    signature_data = models.TextField(blank=True, default="", help_text="Base64 signature captured at issue time.")
    qr_code_data = models.TextField(blank=True, default="")

    ar_account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices_ar")
    revenue_account = models.ForeignKey(Account, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices_revenue")
    journal_entry = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.PROTECT, related_name="invoice_source")

    credits = models.OneToOneField("self", null=True, blank=True, related_name="credited_by", on_delete=models.PROTECT, help_text="The original invoice this Credit Note cancels.")
    replaces = models.OneToOneField("self", null=True, blank=True, related_name="replaced_by", on_delete=models.PROTECT, help_text="The original invoice this replacement re-issues.")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_invoices")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.number} - {self.party.full_name} - {self.total_amount}"


class FinancialPeriod(models.Model):
    """
    One row per calendar month. Once is_locked=True, the numbers on this
    row are a permanent frozen archive -- always readable, never
    recalculated from live data again, so reviewing a closed month later
    always shows exactly what was true the moment it was closed, even if
    something in a Prior Period Adjustment later touches the new month's
    Retained Earnings.
    """

    year = models.PositiveIntegerField()
    month = models.PositiveSmallIntegerField()

    total_gross_profit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    total_expenses = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    net_profit = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    pending_receivables = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    pending_payables = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))

    is_locked = models.BooleanField(default=False)
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="closed_periods")
    closed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-year", "-month"]
        unique_together = [("year", "month")]

    def __str__(self):
        return f"{self.year}-{self.month:02d}" + (" (locked)" if self.is_locked else "")


class RecurringExpenseTemplate(models.Model):
    """
    A monthly recurring expense line -- salaries, rent, subscriptions,
    utility bills. Set up once; each month the accountant reviews the
    list (adjusting variable amounts like electricity), then runs
    "Post Month's Expenses" to generate one real ExpenseVoucher per
    active template in a single action.
    """

    name = models.CharField(max_length=255)
    category = models.CharField(max_length=100)
    default_amount = models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0"))
    treasury_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="recurring_expense_treasury")
    expense_account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="recurring_expense_bookings")
    is_active = models.BooleanField(default=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_recurring_expenses")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.default_amount})"
