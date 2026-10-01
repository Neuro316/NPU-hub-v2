// src/lib/agent/help/help-id.ts
// Marks a help target id where the attribute value is computed, for example on one button of a
// mapped list: data-help-id={tab.id === 'funnels' ? helpId('campaigns.tab-funnels') : undefined}.
// scripts/agent/build-help-registry.cjs finds every helpId('...') literal as well as every plain
// data-help-id="..." attribute, so the Guide's registry still lists the id.
export const helpId = (id: string) => id
