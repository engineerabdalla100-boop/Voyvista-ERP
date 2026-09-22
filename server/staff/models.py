from django.conf import settings
from django.db import models


class StaffMember(models.Model):
    name = models.CharField(max_length=255)
    position = models.CharField(max_length=255)
    phone = models.CharField(max_length=30)
    email = models.EmailField(blank=True, default="")
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")

    profile_photo = models.TextField(blank=True, default="")
    id_front_photo = models.TextField(blank=True, default="")
    id_back_photo = models.TextField(blank=True, default="")
    criminal_record_photo = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_staff_members")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def is_active(self):
        return self.end_date is None

    def __str__(self):
        return self.name