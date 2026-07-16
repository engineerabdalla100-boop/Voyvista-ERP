# 1. بنستخدم نسخة بايثون خفيفة ومستقرة
FROM python:3.10-slim

# 2. تحديد مجلد العمل داخل الحاوية
WORKDIR /app

# 3. تثبيت الأدوات اللازمة لبناء بعض مكتبات بايثون (مثل psycopg2 لـ PostgreSQL)
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 4. نسخ ملف المكتبات أولاً لتسريع عملية الـ Build
COPY server/requirements.txt .

# 5. تثبيت مكتبات البايثون المطلوبة
RUN pip install --no-cache-dir -r requirements.txt

# 6. نسخ كل ملفات ومجلدات المشروع بالكامل إلى الحاوية
COPY . .

# 7. تعريف الـ PYTHONPATH بشكل صريح داخل الحاوية حتى يرى بايثون المجلد الرئيسي وما يحتويه
ENV PYTHONPATH=/app

# 8. فتح البورت 5000
EXPOSE 5000

# 9. تشغيل السيرفر من المسار الرئيسي مع تمرير الـ PYTHONPATH
CMD ["python", "-m", "server.app"]