// Auto-generated types matching the FSOS Supabase schema
// Regenerate with: npx supabase gen types typescript --project-id YOUR_PROJECT_ID

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      agencies: {
        Row: Agency
        Insert: Omit<Agency, 'days_since_referral' | 'needs_attention'>
        Update: Partial<Omit<Agency, 'agency_id' | 'days_since_referral' | 'needs_attention'>>
      }
      customers: {
        Row: Customer
        Insert: Omit<Customer, 'customer_id' | 'age' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Customer, 'customer_id' | 'age'>>
      }
      policies: {
        Row: Policy
        Insert: Omit<Policy, 'policy_id' | 'days_to_deadline' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Policy, 'policy_id' | 'days_to_deadline'>>
      }
      scores: {
        Row: Score
        Insert: Omit<Score, 'score_id' | 'priority_score' | 'primary_pipeline'>
        Update: Partial<Omit<Score, 'score_id' | 'priority_score' | 'primary_pipeline'>>
      }
      form_submissions: {
        Row: FormSubmission
        Insert: Omit<FormSubmission, 'submission_id' | 'created_at'>
        Update: Partial<Omit<FormSubmission, 'submission_id'>>
      }
      form_sends: {
        Row: FormSend
        Insert: Omit<FormSend, 'send_id'>
        Update: Partial<Omit<FormSend, 'send_id'>>
      }
      commission_rates: {
        Row: CommissionRate
        Insert: Omit<CommissionRate, 'rate_id' | 'created_at'>
        Update: Partial<Omit<CommissionRate, 'rate_id'>>
      }
      commission_cases: {
        Row: CommissionCase
        Insert: Omit<CommissionCase, 'case_id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<CommissionCase, 'case_id'>>
      }
      opra_cases: {
        Row: OpraCase
        Insert: Omit<OpraCase, 'opra_id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<OpraCase, 'opra_id'>>
      }
      agency_referrals: {
        Row: AgencyReferral
        Insert: Omit<AgencyReferral, 'referral_id' | 'submitted_at' | 'created_at'>
        Update: Partial<Omit<AgencyReferral, 'referral_id'>>
      }
      agency_uploads: {
        Row: AgencyUpload
        Insert: Omit<AgencyUpload, 'upload_id' | 'uploaded_at'>
        Update: Partial<Omit<AgencyUpload, 'upload_id'>>
      }
      workshops: {
        Row: Workshop
        Insert: Omit<Workshop, 'workshop_id' | 'created_at'>
        Update: Partial<Omit<Workshop, 'workshop_id'>>
      }
      workshop_registrations: {
        Row: WorkshopRegistration
        Insert: Omit<WorkshopRegistration, 'reg_id' | 'registered_at'>
        Update: Partial<Omit<WorkshopRegistration, 'reg_id'>>
      }
      daily_briefings: {
        Row: DailyBriefing
        Insert: Omit<DailyBriefing, 'briefing_id' | 'generated_at'>
        Update: Partial<Omit<DailyBriefing, 'briefing_id'>>
      }
      consent_ledger: {
        Row: ConsentRecord
        Insert: Omit<ConsentRecord, 'consent_id' | 'recorded_at'>
        Update: never
      }
      customer_profiles: {
        Row: CustomerProfile
        Insert: Omit<CustomerProfile, 'profile_id'>
        Update: Partial<Omit<CustomerProfile, 'profile_id' | 'customer_id'>>
      }
      activity: {
        Row: Activity
        Insert: Omit<Activity, 'activity_id' | 'created_at'>
        Update: Partial<Omit<Activity, 'activity_id'>>
      }
    }
    Functions: {
      score_opra: { Args: { p_customer_id: string }; Returns: number }
      score_conversion: { Args: { p_customer_id: string }; Returns: number }
      score_life: { Args: { p_customer_id: string }; Returns: number }
      score_retirement: { Args: { p_customer_id: string }; Returns: number }
      score_business: { Args: { p_customer_id: string }; Returns: number }
      run_nightly_scoring: { Args: Record<never, never>; Returns: void }
      calculate_case_gdc: {
        Args: {
          p_product_type: string
          p_carrier: string
          p_product: string
          p_option: string | null
          p_age: number
          p_state: string
          p_premium: number
          p_target_premium?: number
          p_fsa_tier_rate?: number
        }
        Returns: {
          gdc_rate: number
          trail_rate: number
          estimated_gdc: number
          estimated_fsa: number
          annual_trail: number
          rate_missing: boolean
        }[]
      }
    }
  }
}

// ── ENTITY TYPES ─────────────────────────────────────────

export interface Activity {
  activity_id: string
  customer_id: string | null
  agency_id: string | null
  type: string
  direction: string | null
  channel: string | null
  subject: string | null
  notes: string | null
  ai_agent: string | null
  ghl_activity_id: string | null
  created_at: string
}

export interface Agency {
  agency_id: string
  name: string
  owner: string
  city: string | null
  phone: string | null
  email: string | null
  slug: string | null
  agency_zoom: boolean
  apex: boolean
  notes: string | null
  first_referral: string | null
  last_referral: string | null
  last_call: string | null
  last_meeting: string | null
  last_email: string | null
  days_since_referral: number        // generated
  needs_attention: boolean           // generated
  created_at: string
  updated_at: string
}

export interface Customer {
  customer_id: string
  agency_id: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  cell_phone: string | null
  dob: string | null
  age: number | null                 // generated
  address: string | null
  city: string | null
  state: string
  zip: string | null
  employer: string | null
  occupation: string | null
  marital_status: string | null
  dependents: number
  has_auto: boolean
  has_home: boolean
  has_life: boolean
  has_umbrella: boolean
  policy_count: number
  source: string
  ghl_contact_id: string | null
  apex_id: string | null
  consent_sms: boolean
  consent_email: boolean
  consent_date: string | null
  created_at: string
  updated_at: string
}

export interface Policy {
  policy_id: string
  customer_id: string
  policy_number: string | null
  policy_type: string
  carrier: string | null
  face_amount: number | null
  annual_premium: number | null
  monthly_premium: number | null
  issue_date: string | null
  expiry_date: string | null
  conversion_deadline: string | null
  days_to_deadline: number | null    // generated
  status: string
  is_employer_group: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Score {
  score_id: string
  customer_id: string
  opra_score: number
  conversion_score: number
  life_score: number
  retirement_score: number
  business_score: number
  priority_score: number             // generated: max of all scores
  primary_pipeline: string           // generated
  risk_score: number | null
  risk_label: string | null
  time_horizon: string | null
  scored_at: string
}

export interface FormSubmission {
  submission_id: string
  customer_id: string | null
  agency_id: string | null
  form_id: string
  form_title: string
  token: string
  status: 'sent' | 'opened' | 'complete' | 'expired'
  sent_at: string
  opened_at: string | null
  submitted_at: string | null
  expires_at: string
  sent_via: string | null
  response_data: Json | null
  fna_report: Json | null
  fna_generated_at: string | null
  fna_urgency: string | null
  ip_address: string | null
  created_at: string
}

export interface FormSend {
  send_id: string
  submission_id: string | null
  customer_id: string | null
  form_id: string
  channel: string
  destination: string
  sent_at: string
  delivered: boolean
  opened_at: string | null
}

export interface CommissionRate {
  rate_id: string
  carrier: string
  product_name: string
  product_type: string
  product_option: string | null
  age_min: number
  age_max: number
  state_code: string
  gdc_rate: number
  trail_rate: number
  trail_years: number
  is_target: boolean
  notes: string | null
  effective_date: string
  archived: boolean
  created_at: string
}

export interface CommissionCase {
  case_id: string
  customer_id: string | null
  agency_id: string | null
  rate_id: string | null
  carrier: string
  product_name: string
  product_type: string
  product_option: string | null
  client_age: number | null
  state_code: string
  premium: number | null
  target_premium: number | null
  gdc_rate_used: number | null
  estimated_gdc: number | null
  estimated_fsa: number | null
  trail_rate_used: number | null
  annual_trail: number | null
  rate_missing: boolean
  actual_gdc: number | null
  actual_fsa: number | null
  pipeline: string | null
  case_status: 'pending' | 'submitted' | 'issued' | 'paid' | 'cancelled' | 'flagged'
  submitted_at: string | null
  issued_at: string | null
  issued_date: string | null
  paid_date: string | null
  fna_submission_id: string | null
  ghl_opportunity_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface OpraCase {
  opra_id: string
  customer_id: string
  agency_id: string | null
  policy_id: string | null
  transfer_date: string | null
  annual_premium: number | null
  contacted: boolean
  contacted_at: string | null
  appt_scheduled: boolean
  appt_date: string | null
  review_complete: boolean
  review_date: string | null
  transferred: boolean
  transferred_date: string | null
  status: string
  notes: string | null
  ghl_contact_id: string | null
  created_at: string
  updated_at: string
}

export interface AgencyReferral {
  referral_id: string
  agency_id: string
  customer_id: string | null
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  referral_type: string | null
  notes: string | null
  status: string
  submitted_at: string
  appt_date: string | null
  outcome_date: string | null
  created_at: string
}

export interface AgencyUpload {
  upload_id: string
  agency_id: string
  filename: string | null
  upload_type: string | null
  record_count: number
  processed_count: number
  opportunities_created: number
  status: string
  error_message: string | null
  drive_file_id: string | null
  uploaded_at: string
  processed_at: string | null
}

export interface Workshop {
  workshop_id: string
  agency_id: string | null
  title: string
  topic: string
  scheduled_at: string
  max_attendees: number
  location: string | null
  registration_link: string | null
  ghl_calendar_id: string | null
  created_at: string
}

export interface WorkshopRegistration {
  reg_id: string
  workshop_id: string
  customer_id: string | null
  registered_at: string
  attended: boolean
  interest_level: string | null
  notes: string | null
  followup_action: string | null
  appointment_booked: boolean
}

export interface DailyBriefing {
  briefing_id: string
  briefing_date: string
  urgent_conversions: number
  appointments_today: number
  new_referrals: number
  opra_due: number
  forms_pending: number
  pipeline_gdc: number | null
  submitted_gdc: number | null
  issued_gdc_ytd: number | null
  ai_calls_made: number
  ai_texts_sent: number
  ai_emails_sent: number
  ai_appointments_booked: number
  priority_actions: Json | null
  raw_data: Json | null
  generated_at: string
}

export interface ConsentRecord {
  consent_id: string
  customer_id: string
  channel: string
  status: 'opted_in' | 'opted_out' | 'pending'
  recorded_at: string
  source: string | null
  ip_address: string | null
  notes: string | null
}

export interface CustomerProfile {
  profile_id: string
  customer_id: string
  annual_income: number | null
  spouse_income: number | null
  household_debt: number | null
  net_worth: number | null
  monthly_savings: number | null
  tax_bracket: string | null
  has_401k: boolean | null
  balance_401k: number | null
  has_ira: boolean | null
  ira_type: string | null
  ira_balance: number | null
  has_life_ins: boolean | null
  life_coverage: number | null
  life_coverage_adequate: boolean | null
  retirement_age: number | null
  retirement_income_goal: number | null
  social_security_est: number | null
  primary_concern: string | null
  secondary_concern: string | null
  risk_score: number | null
  risk_label: string | null
  time_horizon: string | null
  emergency_fund: string | null
  estate_docs: string | null
  business_owner: boolean
  long_term_care: string | null
  forms_completed: string[] | null
  updated_at: string
}

// ── UTILITY TYPES ────────────────────────────────────────

export type CustomerWithScore = Customer & {
  scores: Score | null
  agencies: Pick<Agency, 'agency_id' | 'name' | 'owner'> | null
}

export type CaseWithCustomer = CommissionCase & {
  customers: Pick<Customer, 'first_name' | 'last_name' | 'email'> | null
  agencies: Pick<Agency, 'name'> | null
}

export type AgencyWithStats = Agency & {
  referral_count: number
  opportunity_count: number
  issued_gdc: number
}

export type PipelineType = 'conversions' | 'opra' | 'life' | 'retirement' | 'business' | 'general'
export type CaseStatus = 'pending' | 'submitted' | 'issued' | 'paid' | 'cancelled' | 'flagged'
export type FormStatus = 'sent' | 'opened' | 'complete' | 'expired'


