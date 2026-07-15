-- ==========================================
-- 1. تفعيل الإضافات المتقدمة (اختياري ولكن مفيد لـ UUID)
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- 2. جدول المستخدمين والصلاحيات (Users & Roles)
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    -- تحديد الرتب البرمجية للتحكم بالصلاحيات بدقة
    role VARCHAR(50) NOT NULL CHECK (role IN ('it', 'manager', 'sales', 'flights', 'hotels', 'visas', 'accounts')),
    is_active BOOLEAN DEFAULT TRUE, -- لتعطيل حساب موظف دون حذفه حفاظاً على سجلات العمليات
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 3. نظام المجلدات الافتراضية (Virtual Folders)
-- ==========================================
CREATE TABLE IF NOT EXISTS folders (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL, -- اسم المجلد الذي يكتبه الموظف
    department VARCHAR(50) NOT NULL CHECK (department IN ('sales', 'flights', 'hotels', 'visas', 'accounts', 'all')), -- القسم التابع له
    parent_id INT REFERENCES folders(id) ON DELETE CASCADE, -- لإنشاء مجلدات فرعية (مجلد داخل مجلد)
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    is_deleted BOOLEAN DEFAULT FALSE, -- تم نقله لسلة المهملات
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 4. جدول ملفات الـ Excel المرفوعة
-- ==========================================
CREATE TABLE IF NOT EXISTS excel_files (
    id SERIAL PRIMARY KEY,
    original_name VARCHAR(255) NOT NULL, -- الاسم الأصلي للملف (مثل: حجز_مصر_للطيران.xlsx)
    stored_name VARCHAR(255) UNIQUE NOT NULL, -- الاسم المشفر على السيرفر (لحماية الملفات من التداخل والتكرار)
    file_size INT NOT NULL, -- حجم الملف بالبايت
    folder_id INT REFERENCES folders(id) ON DELETE SET NULL, -- المجلد الحاضن للملف
    department VARCHAR(50) NOT NULL CHECK (department IN ('sales', 'flights', 'hotels', 'visas', 'accounts')), -- القسم المرفوع فيه
    uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
    is_deleted BOOLEAN DEFAULT FALSE, -- تم نقله لسلة المهملات (Rubbish Bin)
    deleted_at TIMESTAMP WITH TIME ZONE,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 5. جدول أرصدة الخزينة الحالية (Treasury Balances)
-- ==========================================
CREATE TABLE IF NOT EXISTS treasury_balances (
    currency VARCHAR(10) PRIMARY KEY CHECK (currency IN ('EGP', 'USD', 'EUR')),
    current_balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- إدخال الأرصدة الافتراضية للعملات الثلاث تلقائياً لو لم تكن موجودة
INSERT INTO treasury_balances (currency, current_balance) VALUES 
('EGP', 0.00),
('USD', 0.00),
('EUR', 0.00)
ON CONFLICT (currency) DO NOTHING;

-- ==========================================
-- 6. جدول حركات الخزينة بالتفصيل المالي (Treasury Transactions)
-- ==========================================
CREATE TABLE IF NOT EXISTS treasury_transactions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL, -- الموظف (المحاسب) الذي قام بالحركة
    currency VARCHAR(10) NOT NULL CHECK (currency IN ('EGP', 'USD', 'EUR')),
    transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('deposit', 'withdraw')), -- نوع الحركة
    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0), -- القيمة المالية
    note TEXT NOT NULL, -- الملاحظة أو التوضيح الإلزامي للعملية
    previous_balance DECIMAL(15, 2) NOT NULL, -- الرصيد قبل تنفيذ العملية (للتدقيق الأمني والمالي)
    new_balance DECIMAL(15, 2) NOT NULL,      -- الرصيد بعد تنفيذ العملية
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 7. سجل حركات النظام والـ IT للامتثال والرقابة (Audit Logs)
-- ==========================================
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL, -- الموظف الذي قام بالفعل
    action VARCHAR(255) NOT NULL, -- الفعل (مثال: "مسح ملف"، "تغيير رصيد الخزينة")
    details TEXT, -- تفاصيل توضيحية كاملة
    ip_address VARCHAR(45), -- الـ IP الخاص بجهاز الموظف للأمان
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);