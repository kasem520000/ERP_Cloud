/**
 * جذر بوابة العملاء يخدم لوحة الحساب مباشرة بحالة HTTP 200 (متسقاً مع `staff` و`admin`
 * و`bakery` وفحص `deploy/vps/smoke.sh` §02)، مع بقاء `/portal` شغالاً بالتطابق.
 */
export { default } from './portal/page';
