'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

interface FormPortalProps {
  formId: string
}

const FORM_TITLES: Record<string, string> = {
  'customer-questionnaire':   'Customer Questionnaire',
  'customer-profile':         'Customer Profile Worksheet',
  'liability-exposure':       'Liability Exposure Worksheet',
  'cash-flow':                'Cash Flow Statement',
  'financial-position':       'Statement of Financial Position',
  'business-questionnaire':   'Business Information Questionnaire',
  'financial-needs-analysis': 'Financial Needs Analysis',
}

type FieldType = 'text' | 'date' | 'tel' | 'email' | 'number' | 'select' | 'textarea'
interface FieldDef {
  name: string
  label: string
  type?: FieldType
  required?: boolean
  options?: string[]
  placeholder?: string
}

const YES_NO = ['Yes', 'No']

// Per-form field configurations — each formId renders its own fields.
const FORM_FIELDS: Record<string, FieldDef[]> = {
  'customer-questionnaire': [
    { name: 'full_name', label: 'Full Name', required: true },
    { name: 'dob', label: 'Date of Birth', type: 'date' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'employer', label: 'Employer / Occupation' },
    { name: 'marital_status', label: 'Marital Status', type: 'select', options: ['Single', 'Married', 'Divorced', 'Widowed'] },
    { name: 'dependents', label: 'Number of Dependents', type: 'number' },
  ],
  'customer-profile': [
    { name: 'full_name', label: 'Full Name', required: true },
    { name: 'dob', label: 'Date of Birth', type: 'date' },
    { name: 'annual_income', label: 'Annual Household Income', placeholder: 'e.g. $85,000' },
    { name: 'spouse_income', label: 'Spouse / Partner Income' },
    { name: 'household_debt', label: 'Total Household Debt' },
    { name: 'net_worth', label: 'Net Worth Estimate' },
    { name: 'monthly_savings', label: 'Monthly Savings' },
    { name: 'tax_bracket', label: 'Tax Bracket', type: 'select', options: ['10%', '12%', '22%', '24%', '32%', '35%', '37%'] },
    { name: 'life_coverage', label: 'Current Life Insurance Coverage' },
    { name: 'primary_concern', label: 'Primary Financial Concern', type: 'textarea' },
    { name: 'secondary_concern', label: 'Secondary Financial Concern' },
    { name: 'retirement_age', label: 'Retirement Age Goal', type: 'number' },
  ],
  'liability-exposure': [
    { name: 'full_name', label: 'Full Name', required: true },
    { name: 'home_value', label: 'Home Value' },
    { name: 'mortgage_balance', label: 'Mortgage Balance' },
    { name: 'auto_value', label: 'Auto Value' },
    { name: 'num_vehicles', label: 'Number of Vehicles', type: 'number' },
    { name: 'umbrella_coverage', label: 'Umbrella Policy Coverage' },
    { name: 'business_ownership', label: 'Business Ownership', type: 'select', options: YES_NO },
    { name: 'liability_concerns', label: 'Personal Liability Concerns', type: 'textarea' },
  ],
  'cash-flow': [
    { name: 'full_name', label: 'Full Name', required: true },
    { name: 'monthly_gross_income', label: 'Monthly Gross Income' },
    { name: 'spouse_income', label: 'Spouse / Partner Income' },
    { name: 'monthly_housing', label: 'Monthly Housing Cost' },
    { name: 'monthly_auto', label: 'Monthly Auto Payment' },
    { name: 'monthly_debt', label: 'Monthly Debt Payments' },
    { name: 'monthly_insurance', label: 'Monthly Insurance Premiums' },
    { name: 'monthly_savings', label: 'Monthly Savings / Investment' },
    { name: 'monthly_other', label: 'Monthly Other Expenses' },
    { name: 'notes', label: 'Additional Notes', type: 'textarea' },
  ],
  'financial-position': [
    { name: 'full_name', label: 'Full Name', required: true },
    { name: 'checking_savings', label: 'Checking / Savings Balance' },
    { name: 'investment_accounts', label: 'Investment Accounts Total' },
    { name: 'retirement_accounts', label: 'Retirement Accounts Total (401k/IRA)' },
    { name: 'real_estate_value', label: 'Real Estate Value' },
    { name: 'other_assets', label: 'Other Assets' },
    { name: 'total_liabilities', label: 'Total Liabilities' },
    { name: 'mortgage_balance', label: 'Mortgage Balance' },
    { name: 'other_debts', label: 'Other Debts' },
    { name: 'net_worth', label: 'Net Worth Estimate' },
  ],
  'business-questionnaire': [
    { name: 'full_name', label: 'Full Name', required: true },
    { name: 'business_name', label: 'Business Name' },
    { name: 'business_type', label: 'Business Type', type: 'select', options: ['LLC', 'S-Corp', 'C-Corp', 'Sole Prop', 'Partnership'] },
    { name: 'years_in_business', label: 'Years in Business', type: 'number' },
    { name: 'num_employees', label: 'Number of Employees', type: 'number' },
    { name: 'annual_revenue', label: 'Annual Revenue' },
    { name: 'business_value', label: 'Business Value Estimate' },
    { name: 'key_person_insurance', label: 'Key Person Insurance', type: 'select', options: YES_NO },
    { name: 'buy_sell_agreement', label: 'Buy-Sell Agreement', type: 'select', options: YES_NO },
    { name: 'business_concern', label: 'Primary Business Concern', type: 'textarea' },
  ],
  'financial-needs-analysis': [
    { name: 'full_name', label: 'Full Name', required: true },
    { name: 'dob', label: 'Date of Birth', type: 'date' },
    { name: 'annual_income', label: 'Annual Household Income', placeholder: 'e.g. $85,000' },
    { name: 'life_coverage', label: 'Current Life Insurance Coverage' },
    { name: 'retirement_savings', label: 'Retirement Savings Total' },
    { name: 'monthly_retirement_savings', label: 'Monthly Retirement Savings' },
    { name: 'social_security_est', label: 'Estimated Social Security Benefit' },
    { name: 'desired_retirement_age', label: 'Desired Retirement Age', type: 'number' },
    { name: 'desired_monthly_income', label: 'Desired Monthly Retirement Income' },
    { name: 'has_401k', label: 'Has 401k', type: 'select', options: YES_NO },
    { name: 'has_ira', label: 'Has IRA', type: 'select', options: YES_NO },
    { name: 'primary_goal', label: 'Primary Financial Goal', type: 'textarea' },
  ],
}

const STEP_SIZE = 4

export default function ClientFormPortal({ formId }: FormPortalProps) {
  const searchParams = useSearchParams()
  const token = searchParams.get('t')
  const clientName = searchParams.get('client') || ''

  const fields = FORM_FIELDS[formId] || FORM_FIELDS['customer-questionnaire']
  const steps: FieldDef[][] = []
  for (let i = 0; i < fields.length; i += STEP_SIZE) steps.push(fields.slice(i, i + STEP_SIZE))
  const totalSteps = steps.length

  const [status, setStatus] = useState<'loading' | 'ready' | 'complete' | 'expired' | 'error'>('loading')
  const [formTitle, setFormTitle] = useState(FORM_TITLES[formId] || 'Form')
  const [responses, setResponses] = useState<Record<string, string>>({ full_name: clientName })
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [ref, setRef] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setStatus('error'); setError('Invalid form link — no token found.'); return }

    fetch(`/api/forms/submit?token=${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setStatus('error'); setError(data.error); return }
        if (data.status === 'complete') { setStatus('complete'); return }
        if (new Date(data.expires_at) < new Date()) { setStatus('expired'); return }
        setFormTitle(data.form_title || FORM_TITLES[formId] || 'Form')
        setStatus('ready')
      })
      .catch(() => { setStatus('error'); setError('Unable to load form.') })
  }, [token, formId])

  function validateStep(stepFields: FieldDef[]): boolean {
    for (const f of stepFields) {
      if (f.required && !(responses[f.name] || '').trim()) {
        setError(`${f.label} is required.`)
        return false
      }
    }
    setError('')
    return true
  }

  function handleNext() {
    if (!validateStep(steps[step])) return
    setStep(s => Math.min(s + 1, totalSteps - 1))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || submitting) return
    // Validate every required field across all steps before submitting
    for (const f of fields) {
      if (f.required && !(responses[f.name] || '').trim()) {
        setError(`${f.label} is required.`)
        return
      }
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, form_id: formId, response_data: { ...responses, client_name: responses.full_name || clientName } }),
      })
      const data = await res.json()
      if (data.success) {
        setRef(data.ref)
        setStatus('complete')
      } else {
        setError(data.error || 'Submission failed.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f9', fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ textAlign: 'center', color: '#6b7a8d' }}>Loading your form…</div>
    </div>
  )

  if (status === 'expired') return (
    <Shell title={formTitle}>
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏱</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1a2332', marginBottom: 8 }}>This link has expired</div>
        <div style={{ fontSize: 14, color: '#6b7a8d' }}>Please contact Markist to request a new form link.</div>
      </div>
    </Shell>
  )

  if (status === 'complete') return (
    <Shell title={formTitle}>
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1a2332', marginBottom: 8 }}>Thank you!</div>
        <div style={{ fontSize: 14, color: '#6b7a8d', marginBottom: ref ? 12 : 0 }}>
          Your {formTitle} has been received. Markist will review it before your appointment.
        </div>
        {ref && <div style={{ fontSize: 12, color: '#a8b4c0', fontFamily: 'monospace' }}>Reference: {ref}</div>}
      </div>
    </Shell>
  )

  if (status === 'error') return (
    <Shell title="Error">
      <div style={{ textAlign: 'center', padding: 32 }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 14, color: '#e53e3e' }}>{error || 'An error occurred loading this form.'}</div>
      </div>
    </Shell>
  )

  const isLastStep = step === totalSteps - 1
  const pct = Math.round(((step + 1) / totalSteps) * 100)

  return (
    <Shell title={formTitle}>
      <form onSubmit={handleSubmit} style={{ padding: '24px 32px' }}>
        {clientName && step === 0 && (
          <p style={{ fontSize: 15, color: '#1a2332', marginBottom: 16 }}>
            Hi <strong>{clientName}</strong>, please complete the form below.
          </p>
        )}

        {/* Progress indicator — Step X of Y */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7a8d', marginBottom: 6 }}>
            <span>Step {step + 1} of {totalSteps}</span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 6, background: '#e4e8ef', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#2b6cb0', transition: 'width .2s' }} />
          </div>
        </div>

        {steps[step].map(f => (
          <FormField
            key={f.name}
            label={f.label}
            name={f.name}
            type={f.type}
            options={f.options}
            placeholder={f.placeholder}
            required={f.required}
            value={responses[f.name] || ''}
            onChange={v => setResponses(r => ({ ...r, [f.name]: v }))}
          />
        ))}

        {error && (
          <div style={{ background: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#e53e3e' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          {step > 0 && (
            <button
              type="button"
              onClick={() => { setError(''); setStep(s => Math.max(s - 1, 0)) }}
              style={{ flex: '0 0 auto', padding: '14px 20px', background: '#fff', color: '#3d4a5c', border: '1px solid #d1d9e0', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
            >
              ← Back
            </button>
          )}
          {!isLastStep ? (
            <button
              type="button"
              onClick={handleNext}
              style={{ flex: 1, padding: 14, background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
            >
              Continue →
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              style={{ flex: 1, padding: 14, background: submitting ? '#a0aec0' : '#2b6cb0', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              {submitting ? 'Submitting…' : 'Submit Form'}
            </button>
          )}
        </div>

        <p style={{ fontSize: 11, color: '#a8b4c0', textAlign: 'center', marginTop: 16, lineHeight: 1.6 }}>
          Your information is encrypted and used only to prepare for your financial review.
          Markist · Farmers Financial Solutions, LLC · Member FINRA &amp; SIPC
        </p>
      </form>
    </Shell>
  )
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9', fontFamily: "'DM Sans', 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' }}>
      <div style={{ width: '100%', maxWidth: 560, background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e4e8ef', boxShadow: '0 2px 12px rgba(0,0,0,.06)' }}>
        <div style={{ background: '#0f1e36', padding: '20px 32px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '.04em' }}>FARMERS FINANCIAL SOLUTIONS</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>{title}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

function FormField({
  label, name, value, onChange, required, type = 'text', placeholder, options
}: {
  label: string; name: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: FieldType; placeholder?: string; options?: string[]
}) {
  const base: React.CSSProperties = {
    width: '100%', padding: '10px 12px', border: '1px solid #d1d9e0', borderRadius: 6,
    fontSize: 14, color: '#1a2332', outline: 'none', boxSizing: 'border-box',
    background: '#fff', fontFamily: 'inherit',
  }
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#3d4a5c', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#e53e3e' }}> *</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          name={name} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} rows={3}
          style={{ ...base, resize: 'vertical' }}
        />
      ) : type === 'select' ? (
        <select name={name} value={value} onChange={e => onChange(e.target.value)} style={base}>
          <option value="">Select…</option>
          {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={type} name={name} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} required={required}
          style={base}
        />
      )}
    </div>
  )
}
