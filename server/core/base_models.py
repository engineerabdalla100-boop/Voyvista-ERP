from django.conf import settings
from django.db import models


class Account(models.Model):
    """
    Ø´Ø¬Ø±Ø© Ø§Ù„Ø­Ø³Ø§Ø¨Ø§Øª â€” Ù†ÙØ³ Ø§Ù„Ø¨Ù†ÙŠØ© Ø§Ù„Ù„ÙŠ Ø¨ÙÙ†ÙŠØª Ø¨Ø§Ù„ÙØ¹Ù„ ÙÙŠ Ø§Ù„ÙØ±ÙˆÙ†Øª Ø¥Ù†Ø¯
    (chart_of_accounts.js: code, name, type, parent, isActive,
    openingBalance). Foreign Key Ø¨Ø³ÙŠØ·Ø© Ù„Ù€parent Ø¨Ø¯Ù„ ØªØ®Ø²ÙŠÙ† Ø´Ø¬Ø±Ø© ÙƒØ§Ù…Ù„Ø©
    ÙƒÙ€JSONØŒ Ø¹Ø´Ø§Ù† Ø§Ù„Ø§Ø³ØªØ¹Ù„Ø§Ù…Ø§Øª (ÙƒÙ„ Ø§Ù„Ø­Ø³Ø§Ø¨Ø§Øª Ø§Ù„ÙØ±Ø¹ÙŠØ© Ù„Ø­Ø³Ø§Ø¨ Ù…Ø¹ÙŠÙ†ØŒ Ù…Ø«Ù„Ù‹Ø§)
    ØªØ¨Ù‚Ù‰ Ø³Ù‡Ù„Ø© ÙˆØ³Ø±ÙŠØ¹Ø© ÙÙŠ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª.
    """

    class AccountType(models.TextChoices):
        ASSET = "asset", "Asset"
        LIABILITY = "liability", "Liability"
        EQUITY = "equity", "Equity"
        REVENUE = "revenue", "Revenue"
        EXPENSE = "expense", "Expense"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=255)
    account_type = models.CharField(max_length=16, choices=AccountType.choices)
    parent = models.ForeignKey(
        "self", null=True, blank=True, related_name="children", on_delete=models.PROTECT,
        help_text="Ù„Ùˆ Ø§Ù„Ø­Ø³Ø§Ø¨ Ø¯Ù‡ Ù„ÙŠÙ‡ Ø£Ø¨ ÙÙŠ Ø§Ù„Ø´Ø¬Ø±Ø©. PROTECT Ù…Ø´ CASCADE Ø¹Ù…Ø¯Ù‹Ø§ â€” Ù…Ù†Ø¹ Ø­Ø°Ù Ø£Ø¨ Ù„Ø³Ù‡ Ù„Ù‡ ÙØ±ÙˆØ¹ØŒ Ø¨Ø¯Ù„ Ù…Ø§ ØªØªÙ…Ø³Ø­ Ø§Ù„ÙØ±ÙˆØ¹ ØµØ§Ù…ØªØ©.",
    )
    is_active = models.BooleanField(default=True)

    # Ù…Ù‚ÙÙˆÙ„ Ø¨Ø¹Ø¯ Ø£ÙˆÙ„ Ø­Ø±ÙƒØ© Ù…Ø§Ù„ÙŠØ© Ø­Ù‚ÙŠÙ‚ÙŠØ© â€” Ù†ÙØ³ Ø§Ù„Ù…Ø¨Ø¯Ø£ Ø§Ù„Ù„ÙŠ Ø§ØªØ¨Ù†Ù‰ Ø¹Ù„ÙŠÙ‡
    # chart_of_accounts.js ÙÙŠ Ø§Ù„ÙØ±ÙˆÙ†Øª Ø¥Ù†Ø¯ (opening balance immutable
    # once movements exist). Ø§Ù„Ø¥Ù†ÙØ§Ø° Ø§Ù„ÙØ¹Ù„ÙŠ Ù‡ÙŠØ¨Ù‚Ù‰ ÙÙŠ Ø§Ù„Ù€Serializer/ViewØŒ
    # Ù…Ø´ Ù‡Ù†Ø§ØŒ Ù„ÙƒÙ† Ø§Ù„Ø­Ù‚Ù„ Ù†ÙØ³Ù‡ Ù…ÙˆØ¬ÙˆØ¯ Ù…Ù† Ù‡Ù†Ø§.
    opening_balance = models.DecimalField(max_digits=18, decimal_places=2, default=0)

    # Optimistic Concurrency Control â€” Ø¨ØªØªØ²ÙˆØ¯ Ø¨Ù€1 ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§ ÙÙŠ ÙƒÙ„ .save()
    # Ù„Ø³Ø¬Ù„ Ù…ÙˆØ¬ÙˆØ¯ Ø¨Ø§Ù„ÙØ¹Ù„ (Ù…Ø´ Ø£ÙˆÙ„ Ø¥Ù†Ø´Ø§Ø¡). core/services.py Ø¨ÙŠÙ‚Ø§Ø±Ù† Ø§Ù„Ù‚ÙŠÙ…Ø©
    # Ø¯ÙŠ ÙˆÙ‚Øª Ø§Ù„Ù€approve Ø¨Ø§Ù„Ù‚ÙŠÙ…Ø© Ø§Ù„Ù„ÙŠ ÙƒØ§Ù†Øª Ù…ÙˆØ¬ÙˆØ¯Ø© ÙˆÙ‚Øª ØªÙ‚Ø¯ÙŠÙ… Ø§Ù„Ø·Ù„Ø¨
    # (ChangeRequest.target_version) â€” Ù„Ùˆ Ù…Ø®ØªÙ„ÙØ©ØŒ Ù…Ø¹Ù†Ø§Ù‡ Ø­Ø¯ Ø¹Ø¯Ù‘Ù„ Ø§Ù„Ø­Ø³Ø§Ø¨
    # Ø¨Ø¹Ø¯ Ù…Ø§ Ø§Ù„Ø·Ù„Ø¨ Ø§ØªÙ‚Ø¯Ù‘Ù… ÙˆÙ‚Ø¨Ù„ Ù…Ø§ Ø­Ø¯ ÙŠÙˆØ§ÙÙ‚ Ø¹Ù„ÙŠÙ‡ØŒ ÙØ§Ù„Ø·Ù„Ø¨ ÙŠÙØ±ÙØ¶ ÙƒÙ€STALE
    # Ø¨Ø¯Ù„ Ù…Ø§ ÙŠØ·Ø¨Ù‘Ù‚ ÙÙˆÙ‚ ØªØ¹Ø¯ÙŠÙ„ Ù…Ø§Ø´Ø§ÙÙˆØ´.
    version = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def save(self, *args, **kwargs):
        if self.pk:
            self.version += 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.code} â€” {self.name}"


class ChangeRequest(models.Model):
    """
    Ù…Ø­Ø±Ùƒ Ø§Ù„Ù€Maker-Checker Ø§Ù„Ù…Ø±ÙƒØ²ÙŠ â€” Ø£ÙŠ ØªØ¹Ø¯ÙŠÙ„/Ø­Ø°Ù/Ø¹Ù…Ù„ÙŠØ© Ù…Ø§Ù„ÙŠØ© Ø­Ø³Ø§Ø³Ø© ÙÙŠ
    Ø§Ù„Ù†Ø¸Ø§Ù… Ø¨ØªØ¹Ø¯Ù‘ÙŠ Ù…Ù† Ù‡Ù†Ø§ØŒ Ù…Ø´ Ø¨ØªØªÙ†ÙØ° Ù…Ø¨Ø§Ø´Ø±Ø©. Ù†ÙØ³ Ø§Ù„Ù…ÙÙ‡ÙˆÙ… Ø¨Ø§Ù„Ø¸Ø¨Ø· Ø§Ù„Ù„ÙŠ
    Ø§ØªØ¨Ù†Ù‰ ÙÙŠ change_requests.js Ø¹Ù„Ù‰ Ø§Ù„ÙØ±ÙˆÙ†Øª Ø¥Ù†Ø¯: Ø·Ù„Ø¨ Ø¨ÙŠØªØ³Ø¬Ù‘Ù„ Ø§Ù„Ø£ÙˆÙ„
    (PENDING)ØŒ ÙˆØ¨Ø¹Ø¯ÙŠÙ† Ø­Ø¯ ØªØ§Ù†ÙŠ (Checker) Ø¨ÙŠÙˆØ§ÙÙ‚ Ø£Ùˆ ÙŠØ±ÙØ¶ØŒ ÙˆØ§Ù„ØªÙ†ÙÙŠØ° Ø§Ù„ÙØ¹Ù„ÙŠ
    (Apply) Ø¨ÙŠØ­ØµÙ„ Ø¨Ø³ Ù„Ù…Ø§ ÙŠØªÙˆØ§ÙÙ‚ Ø¹Ù„ÙŠÙ‡.

    entity_type / entity_id: Ø¨Ø¯Ù„ Generic Foreign Key Ù…Ø¹Ù‚Ø¯Ø©ØŒ Ø­Ù‚Ù„ÙŠÙ†
    Ø¨Ø³ÙŠØ·ÙŠÙ† (Ø§Ø³Ù… Ø§Ù„Ù…ÙˆØ¯ÙŠÙˆÙ„ + Ø±Ù‚Ù… Ø§Ù„Ø³Ø¬Ù„) â€” Ø¨ÙŠØ·Ø§Ø¨Ù‚ ØªÙ…Ø§Ù…Ù‹Ø§ module/targetId
    Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯ÙŠÙ† ÙÙŠ change_requests.js Ø¹Ù„Ù‰ Ø§Ù„ÙØ±ÙˆÙ†Øª Ø¥Ù†Ø¯ØŒ ÙØ³Ù‡Ù„ Ø§Ù„Ø±Ø¨Ø· Ø¨ÙŠÙ†Ù‡Ù….

    proposed_data: Ø§Ù„Ù€JSON Ø§Ù„ÙƒØ§Ù…Ù„ Ù„Ù„ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ù…Ù‚ØªØ±Ø­ â€” Ù†ÙØ³ Ù…ÙÙ‡ÙˆÙ… payload/
    fieldChanges ÙÙŠ Ø§Ù„ÙØ±ÙˆÙ†Øª Ø¥Ù†Ø¯ØŒ Ù…Ø­ÙÙˆØ¸ Ù‡Ù†Ø§ ÙƒÙ€JSONField Ø¨Ø¯Ù„ Ø¬Ø¯ÙˆÙ„ Ù…Ù†ÙØµÙ„
    Ù„ÙƒÙ„ Ù†ÙˆØ¹ ØªØºÙŠÙŠØ±.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        APPLY_FAILED = "apply_failed", "Apply Failed"

    entity_type = models.CharField(
        max_length=64,
        help_text="Ø§Ø³Ù… Ø§Ù„Ù…ÙˆØ¯ÙŠÙˆÙ„/Ø§Ù„ÙƒÙŠØ§Ù† Ø§Ù„Ù…Ø³ØªÙ‡Ø¯Ù â€” Ù…Ø«Ø§Ù„: 'account', 'voucher', 'journal_entry'.",
    )
    entity_id = models.CharField(
        max_length=64, null=True, blank=True,
        help_text="Ø±Ù‚Ù…/ÙƒÙˆØ¯ Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„Ù…Ø³ØªÙ‡Ø¯Ù. ÙØ§Ø¶ÙŠ Ù„Ùˆ Ø§Ù„Ø·Ù„Ø¨ Ø¯Ù‡ Ù„Ø¥Ù†Ø´Ø§Ø¡ Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„.",
    )
    proposed_data = models.JSONField(
        help_text="Ø§Ù„ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ù…Ù‚ØªØ±Ø­ ÙƒØ§Ù…Ù„ â€” Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ø¬Ø¯ÙŠØ¯Ø©ØŒ Ø£Ùˆ ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ø¹Ù…Ù„ÙŠØ© Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø©.",
    )

    # Optimistic Concurrency â€” Ù†Ø³Ø®Ø© Ø§Ù„Ù€Target ÙˆÙ‚Øª Ù…Ø§ Ø§Ù„Ø·Ù„Ø¨ Ø§ØªÙ‚Ø¯Ù‘Ù… (ÙØ§Ø¶ÙŠØ©
    # Ù„Ùˆ Ø¯Ù‡ Ø·Ù„Ø¨ Ø¥Ù†Ø´Ø§Ø¡ Ø³Ø¬Ù„ Ø¬Ø¯ÙŠØ¯ØŒ Ù…ÙÙŠØ´ target Ù…ÙˆØ¬ÙˆØ¯ Ø£ØµÙ„Ù‹Ø§ ÙŠØªÙ‚Ø§Ø³). Ù„Ùˆ
    # Ø§Ù„Ù€Target Ø§ØªØºÙŠÙ‘Ø± Ø¨Ø¹Ø¯ ÙƒØ¯Ù‡ ÙˆÙ‚Ø¨Ù„ Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©ØŒ Ø§Ù„Ø·Ù„Ø¨ ÙŠÙØ±ÙØ¶ ÙƒÙ€STALE Ø¨Ø¯Ù„ Ù…Ø§
    # ÙŠØ·Ø¨Ù‘Ù‚ ÙÙˆÙ‚ Ø­Ø§Ù„Ø© Ù…Ø§Ø´Ø§ÙÙ‡Ø§Ø´ Ø§Ù„Ù€maker Ø£ØµÙ„Ù‹Ø§.
    target_version = models.PositiveIntegerField(null=True, blank=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)

    maker = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="made_change_requests",
        help_text="Ù…ÙŠÙ† Ø·Ù„Ø¨ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„.",
    )
    checker = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="checked_change_requests",
        null=True, blank=True,
        help_text="Ù…ÙŠÙ† ÙˆØ§ÙÙ‚/Ø±ÙØ¶ â€” ÙØ§Ø¶ÙŠ Ù„Ø­Ø¯ Ù…Ø§ Ø­Ø¯ ÙŠØ±Ø§Ø¬Ø¹ Ø§Ù„Ø·Ù„Ø¨ ÙØ¹Ù„ÙŠÙ‹Ø§.",
    )

    rejection_reason = models.TextField(blank=True, default="")
    apply_failure_reason = models.TextField(blank=True, default="")

    requested_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-requested_at"]
        indexes = [
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.entity_type}#{self.entity_id or 'new'} â€” {self.status}"


class AppendOnlyQuerySet(models.QuerySet):
    """
    Ø¨ØªÙ‚ÙÙ„ Ø§Ù„ÙØ¬ÙˆØ© Ø§Ù„Ù„ÙŠ instance.save()/.delete() ÙˆØ­Ø¯Ù‡Ù… Ù…Ø§ÙƒØ§Ù†ÙˆØ´ Ø¨ÙŠØºØ·ÙˆÙ‡Ø§:
    Django's QuerySet.update() Ùˆ .delete() Ø¨ÙŠØ¹Ù…Ù„ÙˆØ§ SQL Ù…Ø¨Ø§Ø´Ø± (UPDATE/
    DELETE) Ù…Ù† ØºÙŠØ± Ù…Ø§ ÙŠÙ†Ø§Ø¯ÙˆØ§ save()/delete() Ø¹Ù„Ù‰ Ø£ÙŠ instance Ø®Ø§Ù„Øµ â€”
    ÙØ­Ù…Ø§ÙŠØ© AuditLog.save() ÙƒØ§Ù†Øª Ø¨ØªØªØ®Ø·Ù‰ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ø¹Ù† Ø·Ø±ÙŠÙ‚
    AuditLog.objects.filter(...).update(...). Ø§ØªÙƒØ´ÙØª Ø§Ù„ÙØ¬ÙˆØ© Ø¯ÙŠ Ø¹Ø¨Ø±
    Ø§Ø®ØªØ¨Ø§Ø± ÙØ¹Ù„ÙŠ (core/tests.py's AuditImmutabilityRegressionTests)ØŒ
    Ù…Ø´ Ø§ÙØªØ±Ø§Ø¶.
    """

    def update(self, *args, **kwargs):
        raise ValueError("AuditLog append-only â€” Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ø³ØªØ®Ø¯Ø§Ù… .update() Ø§Ù„Ø¬Ù…Ø§Ø¹ÙŠ Ø¹Ù„Ù‰ Ø£ÙŠ Ø³Ø¬Ù„.")

    def delete(self, *args, **kwargs):
        raise ValueError("AuditLog append-only â€” Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ø³ØªØ®Ø¯Ø§Ù… .delete() Ø§Ù„Ø¬Ù…Ø§Ø¹ÙŠ Ø¹Ù„Ù‰ Ø£ÙŠ Ø³Ø¬Ù„.")


class AuditLog(models.Model):
    """
    Ø³Ø¬Ù„ Ø£Ù…Ù†ÙŠ Append-Only Ø¹Ù„Ù‰ Ù…Ø³ØªÙˆÙ‰ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ (Application-Level) â€” Ù…Ø®ØªÙ„Ù
    Ø¬ÙˆÙ‡Ø±ÙŠÙ‹Ø§ Ø¹Ù† ChangeRequest:

    ChangeRequest = Ø·Ø§Ø¨ÙˆØ± ØªØ´ØºÙŠÙ„ÙŠ Ù…Ø¤Ù‚Øª (Operational Queue). Ø¨Ù…Ø¬Ø±Ø¯ Ù…Ø§
    Ø§Ù„Ø·Ù„Ø¨ ÙŠÙØ¹ØªÙ…Ø¯ Ø£Ùˆ ÙŠÙØ±ÙØ¶ØŒ Ø¯ÙˆØ±Ø© Ø­ÙŠØ§ØªÙ‡ "ÙƒØ·Ù„Ø¨ Ù…Ø¹Ù„Ù‘Ù‚" Ø¨ØªØ®Ù„Øµ.

    AuditLog = Ø£Ø±Ø´ÙŠÙ Ù„ÙƒÙ„ Ø­Ø¯Ø« Ø£Ù…Ù†ÙŠ ÙÙŠ Ø§Ù„Ù†Ø¸Ø§Ù…ØŒ Ø³ÙˆØ§Ø¡ Ù…Ø±Ù‘ Ø¨Ù†Ø¸Ø§Ù… Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø§Øª
    Ø£Ùˆ Ù„Ø£ (ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„ØŒ Ù…Ø­Ø§ÙˆÙ„Ø© ÙˆØµÙˆÙ„ Ù…Ø±ÙÙˆØ¶Ø© 403ØŒ ØªÙ†ÙÙŠØ° Ù…Ø¨Ø§Ø´Ø±ØŒ Ù…ÙˆØ§ÙÙ‚Ø©ØŒ
    Ø±ÙØ¶...).

    âš ï¸ ØªÙˆØ¶ÙŠØ­ ØµØ§Ø¯Ù‚ Ù…Ù‡Ù…: Ø¯Ù‡ Append-Only Ø¹Ù„Ù‰ Ù…Ø³ØªÙˆÙ‰ ÙƒÙˆØ¯ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ø¨Ø³ â€”
    save() ØªØ­ØªÙ‡Ø§ Ø¨ØªØ±ÙØ¶ Ø£ÙŠ Ù…Ø­Ø§ÙˆÙ„Ø© ØªØ¹Ø¯ÙŠÙ„ Ø¨Ø¹Ø¯ Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ (Ø§Ù†Ø¸Ø± ØªØ­Øª)ØŒ Ùˆadmin.py
    Ø¨ÙŠÙ…Ù†Ø¹ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„/Ø§Ù„Ø­Ø°Ù Ù…Ù† ÙˆØ§Ø¬Ù‡Ø© Ø§Ù„Ø£Ø¯Ù…Ù†. Ù„ÙƒÙ† Ø¯Ù‡ Ù…Ø´ Ø­Ù…Ø§ÙŠØ© Ø¹Ù„Ù‰ Ù…Ø³ØªÙˆÙ‰
    Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù†ÙØ³Ù‡Ø§ (Ø²ÙŠ DB triggers Ø£Ùˆ REVOKE UPDATE/DELETE
    privileges Ù„Ù„ÙŠÙˆØ²Ø± Ø¨ØªØ§Ø¹ Django) â€” Ø£ÙŠ Ø­Ø¯ Ø¹Ù†Ø¯Ù‡ ÙˆØµÙˆÙ„ Ù…Ø¨Ø§Ø´Ø± Ù„Ù‚Ø§Ø¹Ø¯Ø©
    Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª (Ù…Ø«Ù„Ù‹Ø§ Ø¹Ø¨Ø± psql Ø£Ùˆ Django shell Ø¨Ù€raw SQL) ÙŠÙ‚Ø¯Ø± ÙŠØªØ®Ø·Ù‰
    Ø§Ù„Ø­Ù…Ø§ÙŠØ© Ø¯ÙŠ. Ø§Ù„Ø§Ø¯Ù‘Ø¹Ø§Ø¡ Ù‡Ù†Ø§ Ù…Ø­Ø¯ÙˆØ¯ Ø¹Ù…Ø¯Ù‹Ø§ Ù„Ù…Ø³ØªÙˆÙ‰ Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ØŒ Ù…Ø´ "immutable"
    Ø¨Ø¥Ø·Ù„Ø§Ù‚.
    """

    class EventType(models.TextChoices):
        LOGIN_SUCCESS = "login_success", "Login Success"
        LOGIN_FAILED = "login_failed", "Login Failed"
        ACCESS_DENIED = "access_denied", "Access Denied (403)"
        CHANGE_SUBMITTED = "change_submitted", "Change Submitted"
        CHANGE_APPLIED_DIRECT = "change_applied_direct", "Change Applied Directly"
        CHANGE_APPROVED = "change_approved", "Change Approved"
        CHANGE_REJECTED = "change_rejected", "Change Rejected"
        CHANGE_APPLY_FAILED = "change_apply_failed", "Change Apply Failed"
        ACCOUNTING_POSTED = "accounting_posted", "Accounting Entry Posted"
        ACCOUNTING_REVERSED = "accounting_reversed", "Accounting Entry Reversed"
        PERIOD_CLOSED = "period_closed", "Financial Period Closed"
        INVOICE_ISSUED = "invoice_issued", "Invoice Issued"
        INVOICE_CREDITED = "invoice_credited", "Invoice Credited & Re-issued"

    event_type = models.CharField(max_length=32, choices=EventType.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="audit_events",
        help_text="ÙØ§Ø¶ÙŠ Ù„Ùˆ Ø§Ù„Ø­Ø¯Ø« Ø­ØµÙ„ Ù‚Ø¨Ù„ Ø£ÙŠ Ù…ØµØ§Ø¯Ù‚Ø© (Ù…Ø«Ø§Ù„: Ù…Ø­Ø§ÙˆÙ„Ø© login ÙØ§Ø´Ù„Ø© Ø¨Ø§Ø³Ù… Ù…Ø³ØªØ®Ø¯Ù… Ù…Ø´ Ù…ÙˆØ¬ÙˆØ¯).",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    entity_type = models.CharField(max_length=64, blank=True, default="")
    entity_id = models.CharField(max_length=64, null=True, blank=True)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    description = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["event_type"]),
            models.Index(fields=["entity_type", "entity_id"]),
            models.Index(fields=["actor"]),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError("AuditLog append-only â€” Ù„Ø§ ÙŠÙ…ÙƒÙ† ØªØ¹Ø¯ÙŠÙ„ Ø³Ø¬Ù„ Ù…ÙˆØ¬ÙˆØ¯ Ø¨Ø§Ù„ÙØ¹Ù„.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("AuditLog append-only â€” Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø­Ø°Ù Ø£ÙŠ Ø³Ø¬Ù„.")

    def __str__(self):
        return f"{self.event_type} â€” {self.actor or 'anonymous'} @ {self.created_at}"