FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# نسخ ملف المكتبات من فولدر server لضمان وجوده
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# نسخ كل ملفات المشروع
COPY . .

# تعريف الـ PYTHONPATH
ENV PYTHONPATH=/app/server

EXPOSE 8000

# تشغيل gunicorn مع تحديد مجلد العمل الداخلي ومسار الـ wsgi المظبوط
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--chdir", "/app/server", "core.wsgi:application"]