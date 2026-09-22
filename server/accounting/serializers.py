from decimal import Decimal

from rest_framework import serializers

from .models import Account, Custody, ExpenseVoucher, FinancialPeriod, Invoice, JournalEntry, JournalLine, RecurringExpenseTemplate, Voucher


class AccountSerializer(serializers.ModelSerializer):
    has_movements = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Account
        fields = [
            "id", "parent", "code", "name", "type", "nature", "currency",
            "opening_balance", "balance", "status", "is_system_account",
            "has_movements", "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "balance", "is_system_account", "created_by", "created_at", "updated_at"]

    def get_has_movements(self, obj):
        return obj.has_movements()

    def validate(self, attrs):
        parent = attrs.get("parent", getattr(self.instance, "parent", None))

        if self.instance and parent:
            cursor = parent
            visited = set()
            while cursor:
                if cursor.id == self.instance.id:
                    raise serializers.ValidationError({"parent": "This would create a circular hierarchy in the Chart of Accounts."})
                if cursor.id in visited:
                    break
                visited.add(cursor.id)
                cursor = cursor.parent

        if parent and parent.status == Account.Status.INACTIVE:
            raise serializers.ValidationError({"parent": f'Parent account "{parent.name}" is inactive and cannot be used as a parent.'})

        if self.instance and self.instance.has_movements():
            guarded_fields = ["code", "parent", "type", "nature", "currency", "opening_balance"]
            changed = [f for f in guarded_fields if f in attrs and attrs[f] != getattr(self.instance, f)]
            if changed:
                raise serializers.ValidationError(
                    {"detail": f"This account has real journal movements -- only name or status can be changed. Attempted to change: {', '.join(changed)}."}
                )

        if self.instance and self.instance.is_system_account:
            if "type" in attrs and attrs["type"] != self.instance.type:
                raise serializers.ValidationError({"type": "System account type cannot be changed."})
            if "nature" in attrs and attrs["nature"] != self.instance.nature:
                raise serializers.ValidationError({"nature": "System account nature cannot be changed."})

        return attrs

    def create(self, validated_data):
        validated_data["balance"] = validated_data.get("opening_balance", 0)
        return super().create(validated_data)


class JournalLineSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source="account.code", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)

    class Meta:
        model = JournalLine
        fields = ["id", "account", "account_code", "account_name", "debit", "credit", "memo", "cost_center"]

    def validate(self, attrs):
        debit = attrs.get("debit") or Decimal("0")
        credit = attrs.get("credit") or Decimal("0")
        if debit < 0 or credit < 0:
            raise serializers.ValidationError("Debit and credit cannot be negative.")
        if debit > 0 and credit > 0:
            raise serializers.ValidationError("A line cannot have both a debit and a credit amount.")
        if debit == 0 and credit == 0:
            raise serializers.ValidationError("A line must have either a debit or a credit amount greater than zero.")
        return attrs


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalLineSerializer(many=True)
    total_debit = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    total_credit = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)
    reverses_number = serializers.CharField(source="reverses.number", read_only=True)
    is_reversed = serializers.SerializerMethodField()

    class Meta:
        model = JournalEntry
        fields = [
            "id", "number", "date", "reference", "description", "status",
            "lines", "total_debit", "total_credit",
            "reverses", "reverses_number", "is_reversed",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "number", "status", "reverses", "created_by", "created_at", "updated_at"]

    def get_is_reversed(self, obj):
        return hasattr(obj, "reversed_by")

    def validate_lines(self, lines):
        if len(lines) < 2:
            raise serializers.ValidationError("A journal entry needs at least 2 lines to balance.")
        return lines

    def validate(self, attrs):
        if "lines" not in attrs:
            return attrs  # partial update not touching lines -- nothing to re-balance
        lines = attrs.get("lines", [])
        total_debit = sum((l.get("debit") or Decimal("0")) for l in lines)
        total_credit = sum((l.get("credit") or Decimal("0")) for l in lines)
        if total_debit != total_credit:
            raise serializers.ValidationError(
                {"detail": f"Entry is unbalanced -- total debit ({total_debit}) must equal total credit ({total_credit})."}
            )
        if total_debit == 0:
            raise serializers.ValidationError({"detail": "Entry cannot be empty -- enter an amount on at least one line."})
        return attrs

    def create(self, validated_data):
        lines_data = validated_data.pop("lines")
        entry = JournalEntry.objects.create(**validated_data)
        for line in lines_data:
            JournalLine.objects.create(entry=entry, **line)
        return entry

    def update(self, instance, validated_data):
        if instance.status != JournalEntry.Status.DRAFT:
            raise serializers.ValidationError({"detail": "Only a draft entry can be edited."})
        lines_data = validated_data.pop("lines", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            instance.lines.all().delete()
            for line in lines_data:
                JournalLine.objects.create(entry=instance, **line)
        return instance

class CustodySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee.username", read_only=True)
    remaining = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Custody
        fields = [
            "id", "number", "date", "employee", "employee_name", "amount", "spent", "remaining",
            "currency", "due_date",
            "treasury_account", "custody_account", "description", "status",
            "journal_entry", "settlement_entry",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "number", "spent", "status", "journal_entry", "settlement_entry", "created_by", "created_at", "updated_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value


class ExpenseVoucherSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)
    custody_number = serializers.CharField(source="custody.number", read_only=True)

    class Meta:
        model = ExpenseVoucher
        fields = [
            "id", "number", "date", "category", "amount", "payment_method",
            "currency", "exchange_rate", "booking_reference", "vat_amount", "vat_account",
            "attachment_name", "attachment_data",
            "treasury_account", "custody", "custody_number", "expense_account",
            "invoice_number", "description", "status", "reverses", "journal_entry",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "number", "status", "reverses", "journal_entry", "created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        amount = attrs.get("amount", getattr(self.instance, "amount", None))
        if amount is not None and amount <= 0:
            raise serializers.ValidationError({"amount": "Amount must be greater than zero."})

        payment_method = attrs.get("payment_method", getattr(self.instance, "payment_method", None))
        treasury_account = attrs.get("treasury_account", getattr(self.instance, "treasury_account", None))
        custody = attrs.get("custody", getattr(self.instance, "custody", None))

        if payment_method in (ExpenseVoucher.PaymentMethod.CASH, ExpenseVoucher.PaymentMethod.BANK):
            if not treasury_account:
                raise serializers.ValidationError({"treasury_account": "Required for Cash/Bank payment method."})
        elif payment_method == ExpenseVoucher.PaymentMethod.CUSTODY:
            if not custody:
                raise serializers.ValidationError({"custody": "Required for Custody payment method."})
            if custody.status != Custody.Status.POSTED:
                raise serializers.ValidationError({"custody": f'Custody "{custody.number}" is not open (status: {custody.status}).'})
            if amount and amount > custody.remaining:
                raise serializers.ValidationError({"amount": f"Amount exceeds remaining custody balance ({custody.remaining})."})

        return attrs


class VoucherSerializer(serializers.ModelSerializer):
    party_name = serializers.CharField(source="party.full_name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Voucher
        fields = [
            "id", "number", "type", "date", "party", "party_name", "amount",
            "payment_method", "currency", "exchange_rate", "booking", "booking_reference", "transaction_reference",
            "attachment_name", "attachment_data",
            "treasury_account", "party_control_account", "description", "status",
            "reverses", "journal_entry", "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "number", "status", "reverses", "journal_entry", "created_by", "created_at", "updated_at"]

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value


class InvoiceSerializer(serializers.ModelSerializer):
    party_name = serializers.CharField(source="party.full_name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)
    credits_number = serializers.CharField(source="credits.number", read_only=True)
    replaces_number = serializers.CharField(source="replaces.number", read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id", "number", "date", "party", "party_name", "booking", "booking_reference",
            "total_amount", "description", "status", "is_issued", "issued_at",
            "signature_data", "qr_code_data", "ar_account", "revenue_account", "journal_entry",
            "credits", "credits_number", "replaces", "replaces_number",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "number", "status", "is_issued", "issued_at",
            "credits", "replaces", "created_by", "created_at", "updated_at",
        ]

    def validate(self, attrs):
        # An issued invoice is locked -- only a Credit Note (a separate
        # action) can neutralize it, never a direct edit.
        if self.instance and self.instance.is_issued:
            raise serializers.ValidationError({"detail": "This invoice has already been issued and is locked. Use Credit Note & Re-issue to correct it."})
        return attrs


class FinancialPeriodSerializer(serializers.ModelSerializer):
    closed_by_name = serializers.CharField(source="closed_by.username", read_only=True)

    class Meta:
        model = FinancialPeriod
        fields = [
            "id", "year", "month", "total_gross_profit", "total_expenses", "net_profit",
            "pending_receivables", "pending_payables", "is_locked", "closed_by", "closed_by_name",
            "closed_at", "created_at",
        ]
        read_only_fields = [
            "id", "total_gross_profit", "total_expenses", "net_profit",
            "pending_receivables", "pending_payables", "is_locked", "closed_by", "closed_at", "created_at",
        ]


class RecurringExpenseTemplateSerializer(serializers.ModelSerializer):
    treasury_account_name = serializers.CharField(source="treasury_account.name", read_only=True)
    expense_account_name = serializers.CharField(source="expense_account.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = RecurringExpenseTemplate
        fields = [
            "id", "name", "category", "default_amount", "treasury_account", "treasury_account_name",
            "expense_account", "expense_account_name", "is_active",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]
