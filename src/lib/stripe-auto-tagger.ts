// src/lib/stripe-auto-tagger.ts
// ═══════════════════════════════════════════════════════════════
// Stripe → CRM Auto-Tagging Logic
//
// Called from the Stripe webhook after checkout.session.completed.
// Looks up the product_type metadata, finds the corresponding tag
// in stripe_product_tag_map, and applies it to the contact.
//
// Tag is added to both `tags[]` and `auto_tags[]`.
// If tag triggers participant creation, the DB trigger handles it.
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface AutoTagResult {
  contact_id: string | null
  tags_applied: string[]
  enrollment_type: string | null
  contact_created: boolean
  error?: string
}

/**
 * Apply auto-tags to a contact based on Stripe checkout metadata.
 * 
 * @param orgId - Organization ID
 * @param email - Customer email from Stripe
 * @param name - Customer name from Stripe
 * @param productType - From Stripe metadata: 'cohort' | 'subscription' | 'coach_plan'
 * @param stripeProductId - Optional Stripe product ID for exact matching
 */
export async function applyStripeAutoTags(
  orgId: string,
  email: string,
  name: string,
  productType: string,
  stripeProductId?: string
): Promise<AutoTagResult> {
  try {
    // ─── Look up tag mapping ───
    let query = supabase
      .from('stripe_product_tag_map')
      .select('*')
      .eq('org_id', orgId)

    // Try exact product ID match first, fall back to product_type
    if (stripeProductId) {
      const { data: exactMatch } = await query
        .eq('stripe_product_id', stripeProductId)
        .limit(1)
        .single()

      if (exactMatch) {
        return await applyTagToContact(orgId, email, name, exactMatch)
      }
    }

    // Fall back to product_type match
    const { data: typeMatch } = await supabase
      .from('stripe_product_tag_map')
      .select('*')
      .eq('org_id', orgId)
      .eq('product_type', productType)
      .limit(1)
      .single()

    if (!typeMatch) {
      return {
        contact_id: null,
        tags_applied: [],
        enrollment_type: null,
        contact_created: false,
        error: `No tag mapping found for product_type="${productType}"`,
      }
    }

    return await applyTagToContact(orgId, email, name, typeMatch)

  } catch (err: any) {
    console.error('Stripe auto-tagger error:', err)
    return {
      contact_id: null,
      tags_applied: [],
      enrollment_type: null,
      contact_created: false,
      error: err.message,
    }
  }
}

async function applyTagToContact(
  orgId: string,
  email: string,
  name: string,
  tagConfig: any
): Promise<AutoTagResult> {
  const tag = tagConfig.tag
  const enrollmentType = tagConfig.enrollment_type

  // ─── Find or create contact ───
  let contact: any = null
  let contactCreated = false

  // Try email match
  if (email) {
    const { data: emailMatch } = await supabase
      .from('contacts')
      .select('*')
      .eq('org_id', orgId)
      .ilike('email', email)
      .limit(1)
      .single()

    contact = emailMatch
  }

  // Try name match if no email match
  if (!contact && name) {
    const parts = name.trim().split(/\s+/)
    const firstName = parts[0] || ''
    const lastName = parts.slice(1).join(' ') || ''

    if (firstName && lastName) {
      const { data: nameMatch } = await supabase
        .from('contacts')
        .select('*')
        .eq('org_id', orgId)
        .ilike('first_name', firstName)
        .ilike('last_name', lastName)
        .limit(1)
        .single()

      contact = nameMatch
    }
  }

  // Create new contact if no match
  if (!contact) {
    const parts = name.trim().split(/\s+/)
    const firstName = parts[0] || ''
    const lastName = parts.slice(1).join(' ') || ''

    const { data: newContact, error: insertErr } = await supabase
      .from('contacts')
      .insert({
        org_id: orgId,
        first_name: firstName,
        last_name: lastName,
        email: email || null,
        pipeline_stage: 'Enrolled',
        tags: [tag],
        auto_tags: [tag],
        enrollment_type: enrollmentType,
        source: 'stripe',
        notes: `Auto-created from Stripe purchase (${tagConfig.product_type})`,
      })
      .select()
      .single()

    if (insertErr) throw insertErr
    contact = newContact
    contactCreated = true

    // Audit
    await supabase.from('integration_audit_log').insert({
      source: 'stripe',
      action: 'tag_added',
      contact_id: contact.id,
      org_id: orgId,
      payload: { tag, email, name, product_type: tagConfig.product_type, contact_created: true },
      result: 'success',
    })

    return {
      contact_id: contact.id,
      tags_applied: [tag],
      enrollment_type: enrollmentType,
      contact_created: true,
    }
  }

  // ─── Contact exists — add tag if not already present ───
  const existingTags: string[] = contact.tags || []
  const existingAutoTags: string[] = contact.auto_tags || []

  const newTags = existingTags.includes(tag) ? existingTags : [...existingTags, tag]
  const newAutoTags = existingAutoTags.includes(tag) ? existingAutoTags : [...existingAutoTags, tag]

  const updates: any = {
    tags: newTags,
    auto_tags: newAutoTags,
    updated_at: new Date().toISOString(),
  }

  // Set enrollment_type if not already set
  if (!contact.enrollment_type) {
    updates.enrollment_type = enrollmentType
  }

  // Move to Enrolled pipeline if not already there or further along
  const enrolledStages = ['Enrolled', 'Active', 'Completed']
  if (!enrolledStages.includes(contact.pipeline_stage || '')) {
    updates.pipeline_stage = 'Enrolled'
  }

  const { error: updateErr } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', contact.id)

  if (updateErr) throw updateErr

  // Audit
  await supabase.from('integration_audit_log').insert({
    source: 'stripe',
    action: 'tag_added',
    contact_id: contact.id,
    org_id: orgId,
    payload: {
      tag,
      email,
      name,
      product_type: tagConfig.product_type,
      was_new_tag: !existingTags.includes(tag),
    },
    result: 'success',
  })

  return {
    contact_id: contact.id,
    tags_applied: existingTags.includes(tag) ? [] : [tag],
    enrollment_type: enrollmentType,
    contact_created: false,
  }
}

/**
 * Snippet to add to your existing Stripe webhook handler
 * (src/app/api/stripe/webhook/route.ts)
 * 
 * Inside the `checkout.session.completed` case, after existing logic:
 * 
 * ```ts
 * import { applyStripeAutoTags } from '@/lib/stripe-auto-tagger'
 * 
 * // After existing enrollment/payment logic:
 * const productType = session.metadata?.product_type
 * if (productType) {
 *   const orgId = session.metadata?.org_id || '00000000-0000-0000-0000-000000000001'
 *   const email = session.customer_email || session.customer_details?.email || ''
 *   const name = session.metadata?.customer_name || session.customer_details?.name || ''
 *   
 *   const tagResult = await applyStripeAutoTags(orgId, email, name, productType)
 *   console.log('Auto-tag result:', tagResult)
 * }
 * ```
 */
