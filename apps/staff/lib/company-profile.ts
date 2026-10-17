import type { CompanyProfileDto } from '@erp/contracts';

import { apiData } from './api';

/**
 * 🏢 هويّة المنشأة المطبوعة على الإيصالات — الاسم القانوني والرقم الضريبي كما هما في
 * `company_profiles` (المصدر نفسه الذي تقرأه وثيقة الطباعة على الخادم ووحدة الفوترة
 * الإلكترونية).
 *
 * لا قيم ثابتة هنا: الإيصالات كانت تحمل «ERP Cloud KSA» والرقم `300000000000003` لكلّ
 * مستأجر، وهذا ليس زينةً بريئة — إنّه اسم بائعٍ ورقم ضريبي لا يخصّان المنشأة التي
 * تطبع الورقة. الغياب يُطبع غيابًا: السطر يُحذف، والاسم يرجع لما تعرفه الشاشة (الفرع).
 *
 * القراءة best-effort: `GET /company-profile` يحتاج `organization.companyprofile.view`،
 * وبائع الكاشير غالبًا لا يملكه، والمنشأة قد لا تكون سجّلت ملفًّا بعد (404) — في كلٍّ من
 * الحالتين تُرجع `null` ولا تُعطّل البيع ولا الطباعة.
 */
export async function readCompanyProfile(): Promise<CompanyProfileDto | null> {
  try {
    return await apiData<CompanyProfileDto>('/company-profile');
  } catch {
    return null;
  }
}

/**
 * ما يُطبع في ترويسة الإيصال: اسم المنشأة المسجَّل إن وُجد، وإلّا الاسم البديل الذي
 * تعرفه الشاشة (اسم الفرع مثلًا). الرقم الضريبي فارغٌ حين لا يكون مسجَّلًا، فتترك
 * `printThermalReceipt80mm` السطر كلّه.
 */
export function receiptIdentity(
  profile: CompanyProfileDto | null,
  fallbackName: string,
): { companyName: string; taxNo: string } {
  return {
    companyName: profile?.nameAr?.trim() || fallbackName.trim() || 'المنشأة',
    taxNo: profile?.taxNo?.trim() || '',
  };
}
