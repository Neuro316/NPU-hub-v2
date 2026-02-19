import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { graphData } = await request.json()
  if (!graphData) return NextResponse.json({ error: 'Missing graphData' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY

  // ── Local graph analysis (always runs, no API needed) ──
  function generateLocalInsights() {
    const insights: any[] = []
    const nodes = graphData.nodes || []
    const edges = graphData.edges || []
    const clusters = graphData.clusters || []

    // Build adjacency
    const adj = new Map<string, Set<string>>()
    edges.forEach((e: any) => {
      if (!adj.has(e.from)) adj.set(e.from, new Set())
      if (!adj.has(e.to)) adj.set(e.to, new Set())
      adj.get(e.from)!.add(e.to)
      adj.get(e.to)!.add(e.from)
    })

    // Find bridge opportunities: nodes connected to multiple clusters
    const nodeCluster = new Map<string, number | undefined>(nodes.map((n: any) => [n.id, n.cluster_id]))
    nodes.forEach((n: any) => {
      const neighbors = adj.get(n.id) || new Set()
      const neighborClusters = new Set<number>()
      neighbors.forEach(nId => {
        const c = nodeCluster.get(nId)
        if (c !== undefined && c !== n.cluster_id) neighborClusters.add(c)
      })
      if (neighborClusters.size >= 2) {
        insights.push({
          type: 'bridge_opportunity', priority: 'high', confidence: 0.85,
          title: `${n.name} bridges ${neighborClusters.size + 1} groups`,
          description: `This person connects across multiple clusters in your network, making them valuable for introductions and cross-pollination.`,
          contact_ids: [n.id],
          action: `Strengthen relationship with ${n.name.split(' ')[0]} and leverage for warm introductions.`
        })
      }
    })

    // Find orphaned high-value nodes
    nodes.forEach((n: any) => {
      if ((adj.get(n.id)?.size || 0) === 0 && n.interaction_score > 0) {
        insights.push({
          type: 'cluster_gap', priority: 'medium', confidence: 0.7,
          title: `${n.name} has no mapped connections`,
          description: `This contact has engagement history but no relationships mapped. Adding connections would strengthen your network visibility.`,
          contact_ids: [n.id],
          action: `Map existing relationships for ${n.name.split(' ')[0]}.`
        })
      }
    })

    // Find top connectors
    const sorted = [...nodes].sort((a: any, b: any) => (b.relationship_count || 0) - (a.relationship_count || 0))
    const topConnectors = sorted.slice(0, 3).filter((n: any) => n.relationship_count >= 3)
    if (topConnectors.length > 0) {
      insights.push({
        type: 'referral_chain', priority: 'medium', confidence: 0.9,
        title: `Top connectors: ${topConnectors.map((n: any) => n.name.split(' ')[0]).join(', ')}`,
        description: `These contacts have the most relationships in your network. They are your strongest referral sources and influence nodes.`,
        contact_ids: topConnectors.map((n: any) => n.id),
        action: `Prioritize nurturing these key relationships.`
      })
    }

    // Cluster insights
    clusters.forEach((c: any) => {
      if (c.contact_ids.length >= 4) {
        insights.push({
          type: 'event_suggestion', priority: 'low', confidence: 0.6,
          title: `Group gathering: ${c.dominant_tags?.[0] || `Cluster ${c.id}`} (${c.contact_ids.length} people)`,
          description: `This group shares common tags and connections. Bringing them together could strengthen community bonds.`,
          contact_ids: c.contact_ids.slice(0, 5),
          action: `Consider a focused event or group introduction for this cluster.`
        })
      }
    })

    return insights
  }

  // Always generate local insights
  const localInsights = generateLocalInsights()

  // ── Network gap analysis ──
  try {
    const { data: orgData } = await supabase.from('team_profiles').select('org_id').eq('user_id', user.id).single()
    if (orgData?.org_id) {
      // Run gap analysis function
      try { await supabase.rpc('analyze_network_gaps', { p_org_id: orgData.org_id }) } catch {}
      
      // Fetch gaps
      const { data: gaps } = await supabase.from('network_gap_analysis')
        .select('*').eq('org_id', orgData.org_id).order('severity')
      
      if (gaps?.length) {
        // Group by type
        const byType = new Map<string, any[]>()
        gaps.forEach((g: any) => {
          if (!byType.has(g.analysis_type)) byType.set(g.analysis_type, [])
          byType.get(g.analysis_type)!.push(g)
        })

        byType.forEach((gapList, type) => {
          const highSeverity = gapList.filter(g => g.severity === 'high')
          const label = type === 'geographic' ? 'Geographic' : type === 'industry' ? 'Industry' : type === 'population' ? 'Population' : type
          
          if (gapList.length > 0) {
            localInsights.push({
              type: 'network_gap',
              priority: highSeverity.length > 0 ? 'high' : 'medium',
              confidence: 0.8,
              title: `${label} gap: ${gapList.length} areas with thin coverage`,
              description: gapList.slice(0, 5).map((g: any) => g.gap_label).join(', ') + (gapList.length > 5 ? ` and ${gapList.length - 5} more` : ''),
              contact_ids: [],
              action: gapList[0]?.suggested_action || `Expand outreach to underrepresented ${label.toLowerCase()} areas.`,
            })
          }
        })
      }

      // ── Social follow suggestions ──
      const { data: followSuggestions } = await supabase.from('contacts')
        .select('id,first_name,last_name,linkedin_url,instagram_handle,twitter_handle')
        .eq('org_id', orgData.org_id)
        .eq('social_follow_suggestion', true)
        .is('merged_into_id', null)
        .limit(10)
      
      if (followSuggestions?.length) {
        localInsights.push({
          type: 'social_suggestion',
          priority: 'low',
          confidence: 0.9,
          title: `${followSuggestions.length} contacts to follow on social media`,
          description: `AI research flagged these contacts for social network building: ${followSuggestions.slice(0, 5).map((c: any) => `${c.first_name} ${c.last_name}`).join(', ')}`,
          contact_ids: followSuggestions.map((c: any) => c.id),
          action: `Connect with these contacts on LinkedIn and Instagram to build your professional network.`,
        })
      }

      // ── Engagement intelligence: contacts with low response rates ──
      const { data: lowEngagement } = await supabase.from('contacts')
        .select('id,first_name,last_name,engagement_response_rate,top_responding_topics')
        .eq('org_id', orgData.org_id)
        .not('engagement_response_rate', 'is', null)
        .lt('engagement_response_rate', 20)
        .is('merged_into_id', null)
        .limit(5)
      
      if (lowEngagement?.length) {
        localInsights.push({
          type: 'engagement_alert',
          priority: 'medium',
          confidence: 0.75,
          title: `${lowEngagement.length} contacts with low response rates`,
          description: `These contacts rarely respond to outreach. Consider changing your approach or topic.`,
          contact_ids: lowEngagement.map((c: any) => c.id),
          action: `Review outreach strategy for these contacts. Try different topics or channels.`,
        })
      }

      // ── High response rate contacts worth nurturing ──
      const { data: highEngagement } = await supabase.from('contacts')
        .select('id,first_name,last_name,engagement_response_rate,top_responding_topics')
        .eq('org_id', orgData.org_id)
        .not('engagement_response_rate', 'is', null)
        .gt('engagement_response_rate', 70)
        .is('merged_into_id', null)
        .order('engagement_response_rate', { ascending: false })
        .limit(5)
      
      if (highEngagement?.length) {
        localInsights.push({
          type: 'referral_chain',
          priority: 'medium',
          confidence: 0.85,
          title: `${highEngagement.length} highly responsive contacts`,
          description: `These contacts respond to over 70% of your outreach: ${highEngagement.map((c: any) => c.first_name).join(', ')}. Great candidates for referral requests or collaboration.`,
          contact_ids: highEngagement.map((c: any) => c.id),
          action: `Deepen these relationships. Ask for introductions or co-creation opportunities.`,
        })
      }
    }
  } catch (err) {
    console.warn('Gap analysis skipped:', err)
  }

  // If API key available, enrich with AI analysis
  if (apiKey) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey })

      const nodeSummary = graphData.nodes.slice(0, 100).map((n: any) => ({
        id: n.id, name: n.name, tags: n.tags, pipeline: n.pipeline_stage,
        connections: n.relationship_count, score: n.interaction_score,
        centrality: n.network_centrality, bridge: n.bridge_score, cluster: n.cluster_id,
      }))
      const edgeSummary = graphData.edges.slice(0, 200).map((e: any) => ({
        from: e.from, to: e.to, type: e.type, strength: e.strength,
      }))
      const clusterSummary = graphData.clusters.map((c: any) => ({
        id: c.id, size: c.contact_ids.length, dominant_tags: c.dominant_tags,
      }))

      const msg = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: `You are an AI network analyst for Neuro Progeny / Sensorium Neuro Wellness, a neurotechnology company. Analyze the contact relationship graph and provide actionable insights. Focus on:

1. BRIDGE OPPORTUNITIES: Contacts who could connect otherwise isolated clusters.
2. DORMANT CONNECTORS: Highly connected contacts who haven't been engaged recently.
3. REFERRAL CHAINS: Patterns in how contacts were referred. Top referral sources.
4. EVENT SUGGESTIONS: Groups that would benefit from being brought together.
5. ENGAGEMENT ALERTS: High centrality contacts with low recent interaction.
6. CLUSTER GAPS: Areas where the network is thin.

Use the capacity-over-pathology lens. Frame insights around building connection capacity, not fixing deficits. Forward-oriented language. No em dashes.

Return ONLY a valid JSON array. Each item: { "type": "bridge_opportunity|dormant_connector|cluster_gap|referral_chain|event_suggestion|engagement_alert", "title": "...", "description": "...", "contact_ids": ["..."], "confidence": 0.0-1.0, "action": "suggested next step", "priority": "high|medium|low" }`,
        messages: [{
          role: 'user',
          content: `Analyze this network:\n\nNodes (${nodeSummary.length}):\n${JSON.stringify(nodeSummary, null, 1)}\n\nEdges (${edgeSummary.length}):\n${JSON.stringify(edgeSummary, null, 1)}\n\nClusters (${clusterSummary.length}):\n${JSON.stringify(clusterSummary, null, 1)}`
        }],
      })

      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const aiInsights = JSON.parse(cleaned)
      return NextResponse.json({ insights: aiInsights, source: 'ai' })
    } catch (err: any) {
      console.error('AI insights failed, using local:', err.message)
      // Fall through to local insights
    }
  }

  return NextResponse.json({ insights: localInsights, source: 'local' })
}
