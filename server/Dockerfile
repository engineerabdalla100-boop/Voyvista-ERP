# 1. بنستخدم نسخة بايثون خفيفة ومستقرة
FROM python:3.10-slim

# 2. تحديد مجلد العمل داخل الحاوية
WORKDIR /app

# 3. تثبيت الأدوات اللازمة لبناء بعض مكتبات بايثون
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

# 7. فتح البورت 5000 اللي السيرفر شغال عليه
EXPOSE 5000

# 8. أمر تشغيل السيرفر (بنخليه يشغل app.py من جوه مجلد server)
CMD ["python", "server/app.py"]