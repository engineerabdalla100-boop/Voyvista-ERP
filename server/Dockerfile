# 1. استخدام نسخة بايثون مستقرة وخفيفة
FROM python:3.10-slim

# 2. تحديد مجلد العمل داخل الحاوية
WORKDIR /app

# 3. تثبيت الاعتمادات لنظام التشغيل لضمان استقرار قاعدة البيانات
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 4. نسخ وتثبيت المكتبات
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 5. نسخ ملفات ومجلدات المشروع بالكامل
COPY . .

# 6. تعريف الـ PYTHONPATH لضمان قراءة المجلد الرئيسي
ENV PYTHONPATH=/app

# 7. فتح بورت التشغيل لـ Django
EXPOSE 8000

# 8. تشغيل السيرفر باستخدام gunicorn من داخل مجلد server
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "core.wsgi:application"]