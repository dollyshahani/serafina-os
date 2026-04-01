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

const SCRIPT_STUDIO_SCHEMA = {
  name: 'script_studio_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      locationRecommendation: { type: 'string' },
      visualDirection: { type: 'string' },
      shotList: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            time: { type: 'string' },
            purpose: { type: 'string' },
            scene: { type: 'string' },
            voiceover: { type: 'string' },
            visuals: { type: 'string' },
            angle: { type: 'string' },
            framing: { type: 'string' },
            movement: { type: 'string' },
            textOverlay: { type: 'string' },
            sourceType: { type: 'string' },
            stylingProp: { type: 'string' }
          },
          required: ['time', 'purpose', 'scene', 'voiceover', 'visuals', 'angle', 'framing', 'movement', 'textOverlay', 'sourceType', 'stylingProp']
        }
      },
      editPasses: { type: 'array', items: { type: 'string' } },
      graphicsPlan: { type: 'array', items: { type: 'string' } },
      sourcePlan: { type: 'array', items: { type: 'string' } },
      productionDirection: { type: 'array', items: { type: 'string' } },
      postingPrep: { type: 'array', items: { type: 'string' } }
    },
    required: ['title', 'locationRecommendation', 'visualDirection', 'shotList', 'editPasses', 'graphicsPlan', 'sourcePlan', 'productionDirection', 'postingPrep']
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

function findFirstUrl(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    return /^https?:\/\//i.test(input) ? input : '';
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const hit = findFirstUrl(item);
      if (hit) return hit;
    }
    return '';
  }
  if (typeof input === 'object') {
    for (const value of Object.values(input)) {
      const hit = findFirstUrl(value);
      if (hit) return hit;
    }
  }
  return '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await readJson(req);
    const action = body?.action || 'analyze';

    if (action === 'higgsfield-generate') {
      const apiKey = getEnv('HIGGSFIELD_API_KEY');
      const apiSecret = getEnv('HIGGSFIELD_API_SECRET');
      const model = getEnv('HIGGSFIELD_MODEL', 'higgsfield-ai/dop/standard');
      if (!apiKey || !apiSecret) {
        return sendJson(res, 500, { error: 'HIGGSFIELD_API_KEY or HIGGSFIELD_API_SECRET is not configured' });
      }
      const job = body?.job || {};
      if (!job.imageUrl) return sendJson(res, 400, { error: 'A source image URL is required' });
      if (!job.prompt) return sendJson(res, 400, { error: 'A Higgsfield motion prompt is required' });

      const generateResp = await fetch(`https://platform.higgsfield.ai/${model}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Key ${apiKey}:${apiSecret}`
        },
        body: JSON.stringify({
          image_url: job.imageUrl,
          prompt: job.prompt,
          duration: Number(job.duration || 5) || 5
        })
      });

      const generateData = await generateResp.json();
      if (!generateResp.ok) {
        return sendJson(res, generateResp.status, {
          error: generateData?.error?.message || generateData?.message || `Higgsfield request failed (${generateResp.status})`
        });
      }

      return sendJson(res, 200, {
        ok: true,
        requestId: generateData?.request_id || generateData?.id || '',
        status: generateData?.status || 'queued',
        model,
        raw: generateData
      });
    }

    if (action === 'higgsfield-status') {
      const apiKey = getEnv('HIGGSFIELD_API_KEY');
      const apiSecret = getEnv('HIGGSFIELD_API_SECRET');
      if (!apiKey || !apiSecret) {
        return sendJson(res, 500, { error: 'HIGGSFIELD_API_KEY or HIGGSFIELD_API_SECRET is not configured' });
      }
      const requestId = body?.requestId || '';
      if (!requestId) return sendJson(res, 400, { error: 'requestId is required' });

      const statusResp = await fetch(`https://platform.higgsfield.ai/requests/${requestId}/status`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Key ${apiKey}:${apiSecret}`
        }
      });
      const statusData = await statusResp.json();
      if (!statusResp.ok) {
        return sendJson(res, statusResp.status, {
          error: statusData?.error?.message || statusData?.message || `Higgsfield status failed (${statusResp.status})`
        });
      }
      return sendJson(res, 200, {
        ok: true,
        requestId,
        status: statusData?.status || 'unknown',
        outputUrl: findFirstUrl(statusData),
        raw: statusData
      });
    }

    const apiKey = getEnv('OPENAI_API_KEY');
    const model = getEnv('OPENAI_REEL_MODEL', 'gpt-4.1');
    if (!apiKey) return sendJson(res, 500, { error: 'OPENAI_API_KEY is not configured' });

    if (action === 'script-studio') {
      const title = body?.title || 'Untitled Script';
      const script = body?.script || '';
      const style = body?.style || 'Lana Del Rey style dreamy nostalgia + premium founder documentary';
      if (!script.trim()) return sendJson(res, 400, { error: 'A script is required' });

      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: [{
            role: 'user',
            content: [{
              type: 'input_text',
              text: [
                'You are an elite short-form video director, cinematographer, editor, and art director.',
                'The user will paste a finished script/TXT file. Do NOT rewrite the script.',
                'Your job is execution only: convert the script into a premium, specific, filmmaker-grade production plan.',
                'Be concrete and non-generic. Use the exact script structure, labels, timestamps, and emotional cues in the text.',
                'Honor the style inspiration closely in your execution decisions: color, pacing, camera language, framing, texture, motion, and graphics should all reflect that style.',
                'Optimize for a solo founder making strong personal-brand content with iPhone footage, Adobe Express graphics, Videoleap/CapCut editing, Edits app posting, and frequent Higgsfield support shots.',
                'Assign source types explicitly: Film on iPhone, Existing archive footage, Screen recording, Adobe Express, Higgsfield.',
                'Do not default to generic founder content. If the style is dreamy, nostalgic, romantic, cinematic, or editorial, the output must feel that way in the production decisions.',
                'Make the graphics plan specific: tell her which overlays, widgets, title cards, lower-thirds, subtitles, chapter cards, or UI elements to build, and in which tool.',
                'Make the edit passes specific to Videoleap/CapCut/Adobe Express, not generic editing advice.',
                'Be decisive.',
                `Title: ${title}`,
                `Style inspiration: ${style}`,
                '',
                'SCRIPT:',
                script
              ].join('\n')
            }]
          }],
          text: {
            format: {
              type: 'json_schema',
              ...SCRIPT_STUDIO_SCHEMA
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
      if (!outputText) return sendJson(res, 500, { error: 'No structured production plan returned' });

      let plan;
      try {
        plan = JSON.parse(outputText);
      } catch (err) {
        return sendJson(res, 500, { error: 'Failed to parse structured production plan' });
      }

      return sendJson(res, 200, { ok: true, plan, model });
    }

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
