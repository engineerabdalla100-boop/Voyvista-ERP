from django.contrib.auth.models import AbstractUser
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "ADMIN", "System Administrator"
        OWNER = "OWNER", "Owner"
        IT = "IT", "IT"
        ACCOUNTANT = "ACCOUNTANT", "Accountant"
        OPERATIONS = "OPERATIONS", "Operations Staff"
        SALES = "SALES", "Sales Executive"

    phone_validator = RegexValidator(
        regex=r"^\+?[0-9\s\-()]{7,20}\$",
        message="Enter a valid phone number.",
    )
    email = models.EmailField(unique=True, db_index=True)
    REQUIRED_FIELDS = ["email"]
    phone = models.CharField(max_length=20, blank=True, null=True, validators=[phone_validator])
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.OPERATIONS, db_index=True)
    department = models.CharField(max_length=100, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    allowed_modules = models.JSONField(null=True, blank=True)
    is_active_employee = models.BooleanField(default=True, db_index=True)
    last_seen = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deactivated_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = "users"
        ordering = ["username"]
        indexes = [
            models.Index(fields=["role", "is_active_employee"]),
            models.Index(fields=["is_active_employee", "created_at"]),
        ]

    def __str__(self):
        return f"{self.username} - {self.get_role_display()}"

    @property
    def is_employee_active(self):
        return self.is_active_employee and self.is_active

    def deactivate_employee(self):
        self.is_active_employee = False
        self.deactivated_at = timezone.now()
        self.save(update_fields=["is_active_employee", "deactivated_at", "updated_at"])

    def activate_employee(self):
        self.is_active_employee = True
        self.deactivated_at = None
        self.save(update_fields=["is_active_employee", "deactivated_at", "updated_at"])

    def is_admin_role(self):
        return self.role == self.Role.ADMIN

    def is_accountant(self):
        return self.role == self.Role.ACCOUNTANT

    def is_operations(self):
        return self.role == self.Role.OPERATIONS

    def is_sales(self):
        return self.role == self.Role.SALES