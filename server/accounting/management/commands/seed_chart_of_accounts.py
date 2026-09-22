from django.core.management.base import BaseCommand

from accounting.models import Account
from users.models import User


SEED_ACCOUNTS = [
    ("1000", "\u0627\u0644\u0623\u0635\u0648\u0644", "asset", "debit", None, True),
    ("1010", "\u0627\u0644\u062E\u0632\u064A\u0646\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 (\u0646\u0642\u062F\u064A)", "asset", "debit", "1000", True),
    ("1020", "\u0627\u0644\u062D\u0633\u0627\u0628 \u0627\u0644\u0628\u0646\u0643\u064A", "asset", "debit", "1000", True),
    ("1030", "\u0630\u0645\u0645 \u0627\u0644\u0639\u0645\u0644\u0627\u0621", "asset", "debit", "1000", True),
    ("1040", "\u0639\u0647\u062F \u0627\u0644\u0645\u0648\u0638\u0641\u064A\u0646", "asset", "debit", "1000", True),
    ("1050", "\u0636\u0631\u064A\u0628\u0629 \u0645\u0636\u0627\u0641\u0629 \u0642\u0627\u0628\u0644\u0629 \u0644\u0644\u0627\u0633\u062A\u0631\u062F\u0627\u062F", "asset", "debit", "1000", False),

    ("2000", "\u0627\u0644\u062E\u0635\u0648\u0645", "liability", "credit", None, True),
    ("2010", "\u0630\u0645\u0645 \u0627\u0644\u0645\u0648\u0631\u062F\u064A\u0646", "liability", "credit", "2000", True),
    ("2020", "\u0636\u0631\u064A\u0628\u0629 \u0645\u0636\u0627\u0641\u0629 \u0645\u0633\u062A\u062D\u0642\u0629", "liability", "credit", "2000", False),

    ("3000", "\u062D\u0642\u0648\u0642 \u0627\u0644\u0645\u0644\u0643\u064A\u0629", "equity", "credit", None, True),
    ("3010", "\u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0627\u0644\u0645\u0631\u062D\u0644\u0629", "equity", "credit", "3000", True),

    ("4000", "\u0627\u0644\u0625\u064A\u0631\u0627\u062F\u0627\u062A", "revenue", "credit", None, True),
    ("4010", "\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0627\u0644\u0645\u0628\u064A\u0639\u0627\u062A", "revenue", "credit", "4000", True),
    ("4020", "\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u063A\u0631\u0627\u0645\u0627\u062A \u0627\u0644\u0625\u0644\u063A\u0627\u0621", "revenue", "credit", "4000", False),

    ("5000", "\u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A", "expense", "debit", None, True),
    ("5010", "\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062E\u062F\u0645\u0627\u062A \u0627\u0644\u0645\u0628\u0627\u0639\u0629", "expense", "debit", "5000", True),
    ("5020", "\u0627\u0644\u0631\u0648\u0627\u062A\u0628", "expense", "debit", "5000", False),
    ("5030", "\u0627\u0644\u0625\u064A\u062C\u0627\u0631", "expense", "debit", "5000", False),
    ("5040", "\u0627\u0644\u0645\u0631\u0627\u0641\u0642 (\u0643\u0647\u0631\u0628\u0627\u0621/\u0645\u064A\u0627\u0647/\u0625\u0646\u062A\u0631\u0646\u062A)", "expense", "debit", "5000", False),
    ("5900", "\u0639\u062C\u0632 \u0627\u0644\u062E\u0632\u064A\u0646\u0629 \u062A\u062D\u062A \u0627\u0644\u062A\u0633\u0648\u064A\u0629", "expense", "debit", "5000", True),
]


class Command(BaseCommand):
    help = "Seeds the standard travel-agency Chart of Accounts (Arabic names). Safe to re-run -- skips any code that already exists."

    def handle(self, *args, **options):
        owner = User.objects.filter(role__in=["ADMIN", "OWNER"]).order_by("id").first()
        if not owner:
            self.stdout.write(self.style.ERROR("No ADMIN/OWNER user found -- create one first, then re-run this command."))
            return

        code_to_id = {}
        created_count = 0
        renamed_count = 0

        for code, name, acc_type, nature, parent_code, is_system in SEED_ACCOUNTS:
            existing = Account.objects.filter(code=code).first()
            if existing:
                code_to_id[code] = existing.id
                if existing.name != name:
                    existing.name = name
                    existing.save(update_fields=["name"])
                    renamed_count += 1
                continue

            parent = Account.objects.filter(pk=code_to_id.get(parent_code)).first() if parent_code else None
            account = Account.objects.create(
                code=code, name=name, type=acc_type, nature=nature, parent=parent,
                currency="EGP", is_system_account=is_system, created_by=owner,
            )
            code_to_id[code] = account.id
            created_count += 1

        self.stdout.write(self.style.SUCCESS(f"Seed complete -- {created_count} new, {renamed_count} renamed to Arabic, {len(SEED_ACCOUNTS) - created_count - renamed_count} already correct."))