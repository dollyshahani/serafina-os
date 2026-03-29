const { readJson, sendJson, getEnv } = require('../_lib/http');

const ANALYSIS_SCHEMA = {
  name: 'reel_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      opening: { type: 'string' },
      sceneMap: { type: 'string' },
      shotGrammar: { type: 'string' },
      cameraLanguage: { type: 'string' },
      fontDirection: { type: 'string' },
      secondsPerScene: { type: 'string' },
      pacing: { type: 'string' },
      editStyle: { type: 'string' },
      editMoves: { type: 'string' },
      retentionTriggers: { type: 'string' },
      textStyle: { type: 'string' },
      textOverlaySystem: { type: 'string' },
      textTiming: { type: 'string' },
      audioMood: { type: 'string' },
      audioUse: { type: 'string' },
      colorMood: { type: 'string' },
      paletteNotes: { type: 'string' },
      hookPattern: { type: 'string' },
      anglePattern: { type: 'string' },
      emotionalArc: { type: 'string' },
      emotionSequence: { type: 'string' },
      ctaStyle: { type: 'string' },
      ctaMechanic: { type: 'string' },
      saveWhy: { type: 'string' },
      motionText: { type: 'string' },
      dollyVersion: { type: 'string' },
      remakePlan: { type: 'string' }
    },
    required: [
      'opening',
      'sceneMap',
      'shotGrammar',
      'cameraLanguage',
      'fontDirection',
      'secondsPerScene',
      'pacing',
      'editStyle',
      'editMoves',
      'retentionTriggers',
      'textStyle',
      'textOverlaySystem',
      'textTiming',
      'audioMood',
      'audioUse',
      'colorMood',
      'paletteNotes',
      'hookPattern',
      'anglePattern',
      'emotionalArc',
      'emotionSequence',
      'ctaStyle',
      'ctaMechanic',
      'saveWhy',
      'motionText',
      'dollyVersion',
      'remakePlan'
    ]
  }
};

function extractText(responseJson) {
  if (responseJson.output_text) return responseJson.output_text;
  const parts = [];
  for (const item of responseJson.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (content.type === 'text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const apiKey = getEnv('OPENAI_API_KEY');
  const model = getEnv('OPENAI_REEL_MODEL', 'gpt-4.1');
  if (!apiKey) return sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured' });

  try {
    const body = await readJson(req);
    const ref = body?.reference || {};
    const images = [
      ref.openingShotImg && { label: 'Opening frame', url: ref.openingShotImg },
      ref.middleShotImg && { label: 'Middle frame', url: ref.middleShotImg },
      ref.textShotImg && { label: 'Text overlay frame', url: ref.textShotImg },
      ref.ctaShotImg && { label: 'CTA frame', url: ref.ctaShotImg }
    ].filter(Boolean);

    if (!images.length) {
      return sendJson(res, 400, { error: 'At least one screenshot is required for AI analysis' });
    }

    const content = [
      {
        type: 'input_text',
        text: [
          'You are an elite reel analyst for a founder building premium, story-led Instagram content.',
          'Analyze the provided reel frames as concretely as possible.',
          'Do not be generic. Infer only what is visible in the frames plus the metadata.',
          'Return a creator-grade teardown that helps the user recreate the reel in her own voice.',
          `Creator/source: ${ref.creator || 'Unknown'}`,
          `Source type: ${ref.sourceType || 'reel'}`,
          `Why she liked it: ${ref.why || 'Not specified'}`,
          `Goal for remake: ${ref.goal || 'Make a founder-led reel in her own style'}`,
          `Pillar: ${ref.pillar || 'The Build'}`,
          ref.notes ? `Extra notes: ${ref.notes}` : ''
        ].filter(Boolean).join('\n')
      },
      ...images.flatMap(image => ([
        { type: 'input_text', text: image.label },
        { type: 'input_image', image_url: image.url, detail: 'high' }
      ]))
    ];

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content }],
        text: {
          format: {
            type: 'json_schema',
            ...ANALYSIS_SCHEMA
          }
        }
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      const message = data?.error?.message || `OpenAI request failed (${resp.status})`;
      return sendJson(res, resp.status, { error: message });
    }

    const outputText = extractText(data);
    if (!outputText) return sendJson(res, 500, { error: 'No structured analysis returned' });

    let analysis;
    try {
      analysis = JSON.parse(outputText);
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to parse structured analysis' });
    }

    sendJson(res, 200, { ok: true, analysis, model });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
