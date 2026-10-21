/**
 * العنوان الوطني — the shape written into `parties.address` and `company_profiles.address`.
 *
 * The same seven fields are edited on the customer card, the supplier card and the
 * establishment card, and the same order is printed on the invoice. Keeping the field
 * list here means the three screens cannot drift apart again (they did: the company card
 * listed the fields in a different order from the national-address form).
 */
export type NationalAddress = {
  building?: string;
  street?: string;
  district?: string;
  city?: string;
  postal?: string;
  additional?: string;
  unit?: string;
  /** Legacy keys kept so an old row still prints. */
  plot?: string;
  addStreet?: string;
};

export type AddressFieldName =
  | 'building'
  | 'street'
  | 'district'
  | 'city'
  | 'postal'
  | 'additional'
  | 'unit';

export const NATIONAL_ADDRESS_FIELDS: Array<{
  name: AddressFieldName;
  label: string;
  hint?: string;
  ltr?: boolean;
}> = [
  { name: 'building', label: 'العنوان الوطني — رقم المبنى', hint: '٤ خانات', ltr: true },
  { name: 'street', label: 'العنوان الوطني — الشارع' },
  { name: 'district', label: 'العنوان الوطني — الحي' },
  { name: 'city', label: 'العنوان الوطني — المدينة' },
  { name: 'postal', label: 'العنوان الوطني — الرمز البريدي', hint: '٥ خانات', ltr: true },
  { name: 'additional', label: 'العنوان الوطني — الرقم الإضافي', hint: '٤ خانات', ltr: true },
  { name: 'unit', label: 'العنوان الوطني — رقم الوحدة', ltr: true },
];

/** Values from a stored party into the flat form the `Directory` renders. */
export function addressToForm(address: NationalAddress | null | undefined): Record<string, string> {
  return Object.fromEntries(
    NATIONAL_ADDRESS_FIELDS.map((field) => [field.name, String(address?.[field.name] ?? '')]),
  );
}

/** Flat form values back into the jsonb column — empty fields are dropped, not stored as ''. */
export function formToAddress(values: Record<string, string | boolean>): NationalAddress | undefined {
  const address: NationalAddress = {};
  for (const field of NATIONAL_ADDRESS_FIELDS) {
    const value = String(values[field.name] ?? '').trim();
    if (value) address[field.name] = value;
  }
  return Object.keys(address).length > 0 ? address : undefined;
}

/** One printable line, in the order the national address is written. */
export function addressLine(address: NationalAddress | null | undefined): string {
  if (!address) return '';
  const labels: Partial<Record<keyof NationalAddress, string>> = {
    building: 'مبنى',
    street: 'شارع',
    district: 'حي',
    postal: 'الرمز البريدي',
    additional: 'الرقم الإضافي',
    unit: 'الوحدة',
    plot: 'الرقم الفرعي',
  };
  const order: Array<keyof NationalAddress> = [
    'building',
    'street',
    'addStreet',
    'district',
    'city',
    'postal',
    'additional',
    'unit',
    'plot',
  ];
  return order
    .map((key) => {
      const value = String(address[key] ?? '').trim();
      if (!value) return '';
      const label = labels[key];
      return label ? `${label} ${value}` : value;
    })
    .filter(Boolean)
    .join('، ');
}
