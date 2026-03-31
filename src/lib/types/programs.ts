export type ProgramType = 'cohort' | 'rolling'
export type DeliveryMethod = 'all_at_once' | 'sequential' | 'daily_drip'
export type EnrollmentType = 'paid' | 'manual' | 'both'
export type ProgramStatus = 'draft' | 'live' | 'archived'

export interface Program {
  id: string
  org_id: string
  name: string
  description: string | null
  program_type: ProgramType
  delivery_method: DeliveryMethod
  status: ProgramStatus
  start_date: string | null
  duration: string | null
  price_cents: number | null
  enrollment_type: EnrollmentType
  facilitator_id: string | null
  facilitator_name: string | null
  stripe_product_id: string | null
  stripe_price_id: string | null
  paywall_url: string | null
  course_id: string | null
  cohort_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface WizardState {
  programType: ProgramType | null
  deliveryMethod: DeliveryMethod | null
  name: string
  description: string
  startDate: string
  duration: string
  facilitatorId: string | null
  facilitatorName: string | null
  enrollmentType: EnrollmentType | null
  priceDollars: string
  allowManualAlso: boolean
}

export const INITIAL_WIZARD_STATE: WizardState = {
  programType: null,
  deliveryMethod: null,
  name: '',
  description: '',
  startDate: '',
  duration: '',
  facilitatorId: null,
  facilitatorName: null,
  enrollmentType: null,
  priceDollars: '',
  allowManualAlso: false,
}
