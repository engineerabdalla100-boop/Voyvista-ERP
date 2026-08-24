// client/assets/js/router.js

// 1. تحديد المسار الرئيسي للمشروع تلقائياً
const getBasePath = () => {
    const path = window.location.pathname;
    if (path.includes('/modules/')) {
        // إذا كنا داخل صفحة فرعية داخل modules
        const depth = (path.split('/modules/')[1].match(/\//g) || []).length + 1;
        return '../'.repeat(depth + 1);
    }
    return './';
};

// 2. دالة التنقل الآمن بين الصفحات
function navigateTo(modulePath) {
    const base = getBasePath();
    window.location.href = `${base}${modulePath}`;
}

// 3. تصحيح مسارات الـ CSS والـ Assets المكسورة في الصفحة حياً
document.addEventListener('DOMContentLoaded', () => {
    const basePath = getBasePath();
    
    // إصلاح ملفات الـ CSS
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        const href = link.getAttribute('href');
        if (href && !href.startsWith('http') && !href.startsWith('/')) {
            if (href.includes('css/')) {
                link.href = basePath + 'assets/css/' + href.split('css/')[1];
            }
        }
    });

    // إصلاح ملفات الـ JS
    document.querySelectorAll('script[src]').forEach(script => {
        const src = script.getAttribute('src');
        if (src && !src.startsWith('http') && !src.startsWith('/') && !src.includes('router.js')) {
            if (src.includes('js/')) {
                script.src = basePath + 'assets/js/' + src.split('js/')[1];
            }
        }
    });
});