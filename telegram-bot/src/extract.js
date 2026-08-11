import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const itemProperties = {
  name: { type: ['string', 'null'] },
  location_name: { type: ['string', 'null'] },
  lat: { type: ['number', 'null'] },
  lng: { type: ['number', 'null'] },
  pace: { type: ['string', 'null'] },
  type: { type: ['string', 'null'] },
  surface: { type: ['string', 'null'] },
  freebies: { type: ['boolean', 'null'] },
  day: { type: ['string', 'null'] },
  date: { type: ['string', 'null'] },
  time: { type: ['string', 'null'] },
  link: { type: ['string', 'null'] },
  notes: { type: ['string', 'null'] },
}

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['collection', 'action', 'match_name', 'record', 'missing_fields', 'summary'],
  properties: {
    collection: { type: 'string', enum: ['clubs', 'events'] },
    action: { type: 'string', enum: ['add', 'update'] },
    match_name: { type: ['string', 'null'] },
    record: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(itemProperties),
      properties: itemProperties,
    },
    missing_fields: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

function recordSummary(record) {
  return Object.entries(record)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
}

export async function extractProposal({ text, imageDataUrl, clubs, events }) {
  const context = `You maintain VelocityAE's Dubai running data. Return a proposed complete record from the submission.\n\nRecurring clubs schema: name, location_name, lat, lng, pace (easy / social|tempo|training), type (social|training|track), surface (track|beach|road), freebies, day (lowercase weekday), time (HH:MM 24-hour), link, notes.\nOne-off events schema: same, but use date (YYYY-MM-DD) instead of day.\n\nRules:\n- Choose clubs for recurring weekly runs and events for one-off dated runs.\n- Never invent details. Use null for unknown fields and list missing required fields.\n- Exact coordinates are required. If a location is known but no coordinates or Google Maps URL is supplied, list lat and lng as missing.\n- If an existing item is clearly being changed, action=update and match_name must be its exact existing name. Otherwise action=add.\n- For update records, copy known fields from the matching existing record, then apply only the submitted change.\n- Keep links exactly as supplied.\n\nExisting clubs:\n${JSON.stringify(clubs)}\n\nExisting events:\n${JSON.stringify(events)}\n\nSubmission:\n${text || '(image only)'}`

  const content = [{ type: 'input_text', text: context }]
  if (imageDataUrl) content.push({ type: 'input_image', image_url: imageDataUrl })

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5',
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'velocity_data_proposal',
        strict: true,
        schema,
      },
    },
  })

  if (!response.output_text) throw new Error('OpenAI returned no structured proposal.')
  const proposal = JSON.parse(response.output_text)
  proposal.record_summary = recordSummary(proposal.record)
  return proposal
}
