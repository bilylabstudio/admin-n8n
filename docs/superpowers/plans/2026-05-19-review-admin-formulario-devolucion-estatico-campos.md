# Review Admin Formulario Devolucion Estatico Campos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public return form fields with the approved static open fields and expose the static form from the admin Forms section without changing unrelated admin behavior.

**Architecture:** Add a small shared return-form field helper for labels, parsing, validation, and composing the stored `reason` block. The public client component renders the new required fields, the submit API validates the same payload server-side, and the admin Forms page adds a simple link to open the static form.

**Tech Stack:** Next.js 14 App Router, React client components, Prisma-backed API route, Vitest.

---

## File Structure

- Create `src/lib/return-form-fields.ts`: shared labels, field names, parser, validator, and `reason` formatter for the static return form.
- Create `src/lib/return-form-fields.test.ts`: unit tests for validation and formatting.
- Modify `src/app/forms/devolucion/form-client.tsx`: replace old email/purchaseEmail/reason UI with approved fields and require evidence.
- Modify `src/app/api/forms/devolucion/submit/route.ts`: consume the new field helper and preserve existing anti-spam/upload behavior.
- Modify `src/app/forms/forms-client.tsx`: add a small admin link to `/forms/devolucion`.
- Modify `package.json`: add the new unit test to the existing `npm test` command.

## Tasks

### Task 1: Shared Return Form Field Helper

**Files:**
- Create: `src/lib/return-form-fields.ts`
- Create: `src/lib/return-form-fields.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add shared helper**

Create `src/lib/return-form-fields.ts` with:

```ts
export const RETURN_FORM_REQUIRED_FILE_ERROR = 'missing_evidence';

export type ReturnFormInput = {
  purchaseEmail: string;
  orderNumber: string;
  productAffected: string;
  returnReason: string;
  reasonDetail: string;
  caseExplanation: string;
};

export type ReturnFormValidationError =
  | 'invalid_email'
  | 'missing_order_number'
  | 'missing_product_affected'
  | 'missing_return_reason'
  | 'missing_reason_detail'
  | 'case_explanation_too_short';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CASE_EXPLANATION_MIN_LENGTH = 10;

function clean(value: FormDataEntryValue | string | null): string {
  return String(value ?? '').trim();
}

export function parseReturnFormInput(formData: FormData): ReturnFormInput {
  return {
    purchaseEmail: clean(formData.get('purchaseEmail')).toLowerCase(),
    orderNumber: clean(formData.get('orderNumber')),
    productAffected: clean(formData.get('productAffected')),
    returnReason: clean(formData.get('returnReason')),
    reasonDetail: clean(formData.get('reasonDetail')),
    caseExplanation: clean(formData.get('caseExplanation'))
  };
}

export function validateReturnFormInput(input: ReturnFormInput): ReturnFormValidationError | null {
  if (!EMAIL_RE.test(input.purchaseEmail)) return 'invalid_email';
  if (!input.orderNumber) return 'missing_order_number';
  if (!input.productAffected) return 'missing_product_affected';
  if (!input.returnReason) return 'missing_return_reason';
  if (!input.reasonDetail) return 'missing_reason_detail';
  if (input.caseExplanation.length < CASE_EXPLANATION_MIN_LENGTH) return 'case_explanation_too_short';
  return null;
}

export function formatReturnReason(input: ReturnFormInput): string {
  return [
    `Producto afectado: ${input.productAffected}`,
    `Motivo de devolucion: ${input.returnReason}`,
    `Detalle del motivo: ${input.reasonDetail}`,
    `Explicacion del caso: ${input.caseExplanation}`
  ].join('\n\n');
}
```

- [ ] **Step 2: Add helper tests**

Create `src/lib/return-form-fields.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatReturnReason,
  parseReturnFormInput,
  validateReturnFormInput,
  type ReturnFormInput
} from './return-form-fields';

const validInput: ReturnFormInput = {
  purchaseEmail: 'cliente@example.com',
  orderNumber: '#1234',
  productAffected: 'V-Gummies Sleep',
  returnReason: 'Producto danado',
  reasonDetail: 'El frasco llego abierto',
  caseExplanation: 'La caja venia golpeada y el producto estaba derramado.'
};

describe('parseReturnFormInput', () => {
  it('trims fields and normalizes purchase email', () => {
    const data = new FormData();
    data.set('purchaseEmail', ' CLIENTE@EXAMPLE.COM ');
    data.set('orderNumber', ' #1234 ');
    data.set('productAffected', ' Producto ');
    data.set('returnReason', ' Motivo ');
    data.set('reasonDetail', ' Detalle ');
    data.set('caseExplanation', ' Explicacion completa ');

    expect(parseReturnFormInput(data)).toEqual({
      purchaseEmail: 'cliente@example.com',
      orderNumber: '#1234',
      productAffected: 'Producto',
      returnReason: 'Motivo',
      reasonDetail: 'Detalle',
      caseExplanation: 'Explicacion completa'
    });
  });
});

describe('validateReturnFormInput', () => {
  it('accepts the approved required fields', () => {
    expect(validateReturnFormInput(validInput)).toBeNull();
  });

  it('rejects missing required fields with stable error codes', () => {
    expect(validateReturnFormInput({ ...validInput, purchaseEmail: 'bad' })).toBe('invalid_email');
    expect(validateReturnFormInput({ ...validInput, orderNumber: '' })).toBe('missing_order_number');
    expect(validateReturnFormInput({ ...validInput, productAffected: '' })).toBe('missing_product_affected');
    expect(validateReturnFormInput({ ...validInput, returnReason: '' })).toBe('missing_return_reason');
    expect(validateReturnFormInput({ ...validInput, reasonDetail: '' })).toBe('missing_reason_detail');
    expect(validateReturnFormInput({ ...validInput, caseExplanation: 'corto' })).toBe('case_explanation_too_short');
  });
});

describe('formatReturnReason', () => {
  it('stores the new fields as a readable reason block', () => {
    expect(formatReturnReason(validInput)).toContain('Producto afectado: V-Gummies Sleep');
    expect(formatReturnReason(validInput)).toContain('Motivo de devolucion: Producto danado');
    expect(formatReturnReason(validInput)).toContain('Detalle del motivo: El frasco llego abierto');
    expect(formatReturnReason(validInput)).toContain('Explicacion del caso: La caja venia golpeada');
  });
});
```

- [ ] **Step 3: Include the test file in `npm test`**

Change `package.json` script:

```json
"test": "vitest run --environment node src/lib/status.test.ts src/lib/auth.test.ts src/lib/forms.test.ts src/lib/form-uploads.test.ts src/lib/return-form-fields.test.ts"
```

- [ ] **Step 4: Run tests**

Run: `npm.cmd test`

Expected: the new helper tests pass along with existing lib tests.

### Task 2: Submit API Validation and Persistence

**Files:**
- Modify: `src/app/api/forms/devolucion/submit/route.ts`

- [ ] **Step 1: Replace ad hoc field parsing**

Import the helper:

```ts
import {
  formatReturnReason,
  parseReturnFormInput,
  validateReturnFormInput
} from '@/lib/return-form-fields';
```

Remove the local `EMAIL_RE`.

- [ ] **Step 2: Validate approved fields and required evidence**

Replace the old email/order/reason parsing with:

```ts
const input = parseReturnFormInput(formData);
const validationError = validateReturnFormInput(input);
if (validationError) {
  return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
}

const fileEntries = formData.getAll('files').filter((v): v is File => v instanceof File);
if (fileEntries.length === 0) {
  return NextResponse.json({ ok: false, error: 'missing_evidence' }, { status: 400 });
}
if (fileEntries.length > FORM_UPLOAD_LIMITS.MAX_FILES) {
  return NextResponse.json({ ok: false, error: 'too_many_files' }, { status: 400 });
}
```

- [ ] **Step 3: Persist the new fields in existing columns**

Use `input.purchaseEmail` as `customerEmail` and `purchaseEmail`, and store `formatReturnReason(input)` in `reason`:

```ts
const created = await db.formSubmission.create({
  data: {
    token: generateFormToken(),
    type: 'devolucion',
    customerEmail: input.purchaseEmail,
    orderNumber: input.orderNumber,
    purchaseEmail: input.purchaseEmail,
    reason: formatReturnReason(input),
    status: 'submitted',
    submittedAt: new Date(),
    ipAddress: ip,
    userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    expiresAt: formExpiryDate()
  }
});
```

Also update the 24-hour dedupe query to use `input.purchaseEmail`.

- [ ] **Step 4: Run TypeScript check**

Run: `npm.cmd exec tsc -- --noEmit`

Expected: no TypeScript errors.

### Task 3: Public Form UI

**Files:**
- Modify: `src/app/forms/devolucion/form-client.tsx`
- Modify: `src/app/forms/devolucion/page.tsx`

- [ ] **Step 1: Replace component state**

Use state for:

```ts
const [purchaseEmail, setPurchaseEmail] = useState('');
const [orderNumber, setOrderNumber] = useState('');
const [productAffected, setProductAffected] = useState('');
const [returnReason, setReturnReason] = useState('');
const [reasonDetail, setReasonDetail] = useState('');
const [caseExplanation, setCaseExplanation] = useState('');
```

- [ ] **Step 2: Validate client-side fields**

Before submit, check the same required fields:

```ts
if (!EMAIL_RE.test(purchaseEmail.trim())) {
  setError('El email de compra no parece valido.');
  return;
}
if (!orderNumber.trim()) {
  setError('Falta el numero de pedido.');
  return;
}
if (!productAffected.trim()) {
  setError('Falta el producto afectado.');
  return;
}
if (!returnReason.trim()) {
  setError('Falta el motivo de devolucion.');
  return;
}
if (!reasonDetail.trim()) {
  setError('Falta el detalle del motivo.');
  return;
}
if (caseExplanation.trim().length < 10) {
  setError('Explica el caso con un poco mas de detalle.');
  return;
}
if (files.length === 0) {
  setError('Adjunta al menos una foto o evidencia.');
  return;
}
```

- [ ] **Step 3: Submit the approved field names**

Set these keys in `FormData`:

```ts
body.set('purchaseEmail', purchaseEmail.trim().toLowerCase());
body.set('orderNumber', orderNumber.trim());
body.set('productAffected', productAffected.trim());
body.set('returnReason', returnReason.trim());
body.set('reasonDetail', reasonDetail.trim());
body.set('caseExplanation', caseExplanation.trim());
```

- [ ] **Step 4: Render approved labels**

The visible fields must be:

- `Email de compra *`
- `Numero de pedido *`
- `Producto afectado *`
- `Motivo de devolucion *`
- `Detalle del motivo *`
- `Explicacion del caso *`
- `Fotos o evidencia *`

Keep existing classes: `public-form`, `public-form-field`, `public-form-files`, `public-form-error`, and `public-form-submit`.

- [ ] **Step 5: Update copy in page header**

Keep the same card layout and logo. Use concise copy saying the team will review the case and respond by email.

### Task 4: Admin Forms Link and Verification

**Files:**
- Modify: `src/app/forms/forms-client.tsx`

- [ ] **Step 1: Add static form link in the Forms rail**

Under the status nav, add:

```tsx
<div className="static-form-link">
  <span>Formulario estatico</span>
  <a href="/forms/devolucion" target="_blank" rel="noreferrer">
    Ver devolucion
  </a>
</div>
```

Use inline styles or existing small button classes to avoid broad CSS changes.

- [ ] **Step 2: Run tests and build**

Run:

```powershell
npm.cmd test
npm.cmd run build
```

Expected:

- Tests pass.
- Build succeeds.
- `/forms/devolucion` renders the static form with the approved fields.
- `/forms` still renders the admin Forms section.

- [ ] **Step 3: Commit implementation**

Run:

```powershell
git add src/lib/return-form-fields.ts src/lib/return-form-fields.test.ts src/app/forms/devolucion/form-client.tsx src/app/forms/devolucion/page.tsx src/app/api/forms/devolucion/submit/route.ts src/app/forms/forms-client.tsx package.json
git commit -m "Update static return form fields"
```

## Self-Review

- Spec coverage: The plan covers public no-token form, required fields, evidence requirement, existing design, existing storage model, admin visibility, and verification.
- Placeholder scan: The plan contains no unfinished markers or vague implementation steps.
- Type consistency: `purchaseEmail`, `orderNumber`, `productAffected`, `returnReason`, `reasonDetail`, and `caseExplanation` are used consistently across helper, client, and API.
