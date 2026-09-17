import 'dotenv/config';
import OpenAI from 'openai';

// --- config ------------------------------------------------------------------
// Reads keys from server/.env (NVIDIA_API_KEY / NVIDIA_API_KEY_2). Key values
// are never printed by this script.
const ENDPOINTS = [
  { label: 'nvidiaChatClient', key: process.env.NVIDIA_API_KEY || '', indexName: 'NVIDIA_API_KEY' },
  { label: 'nvidiaChatClient2', key: process.env.NVIDIA_API_KEY_2 || '', indexName: 'NVIDIA_API_KEY_2' },
] as const;

// Every NVIDIA-hosted chat candidate this account has been seen trying.
const MODELS: string[] = [
  'meta/muse-glimmer-30b',
  'z-ai/glm-5.3-flash',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
];

const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const TIMEOUT_MS = 45_000;
const EMIT_REQUESTS_LOGGING = false; // set true to also dump the wire JSON body

// --- defensive error decoder -------------------------------------------------
// The OpenAI SDK collapses many failures to "400 status code (no body)". The
// real validation message usually lives in err.body / err.error / raw bytes /
// err.response.data, so this extracts every shape we know about.
function fmtError(err: unknown): string {
  const e = err as any;
  if (!e) return 'unknown error (falsy)';

  const parts: string[] = [];
  if (e.status) parts.push(`status=${e.status}`);
  if (e.code) parts.push(`code=${e.code}`);
  if (e.type) parts.push(`type=${e.type}`);
  if (e.request_id) parts.push(`request_id=${e.request_id}`);
  if (e.headers) {
    try {
      const ct = (e.headers as Record<string, unknown>)['content-type'];
      if (ct) parts.push(`content-type=${ct}`);
    } catch { /* ignore */ }
  }

  // --- raw body, in priority order: body -> response.data -> error object ----
  const candidates = [e.body, e.response?.data, e.error];
  for (const raw of candidates) {
    if (raw == null) continue;
    let text = '';
    try {
      if (typeof raw === 'string') text = raw;
      else if (raw instanceof Uint8Array || ArrayBuffer.isView(raw)) text = new TextDecoder().decode(raw);
      else if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
      else if (typeof raw === 'object') text = JSON.stringify(raw, null, 2);
      else text = String(raw);
    } catch {
      text = '<unserializable response body>';
    }
    const trimmed = text.trim().slice(0, 1000);
    if (trimmed) {
      parts.push(`body=${trimmed}`);
      break; // only surface the deepest/most useful body once
    }
  }

  if (parts.length === 0) {
    if (typeof e?.message === 'string') parts.push(`message=${e.message}`);
    else parts.push(`raw=${String(err)}`);
  }

  if (e?.cause?.message) parts.push(`cause=${e.cause.message}`);

  return parts.join(' | ');
}

// --- minimal single-turn completion -------------------------------------------
// Payload is deliberately stripped to `model` + `messages` (+ stream flag).
// No temperature/top_p/max_tokens/chat-template kwargs: reasoning models are
// strict about extra properties, and a bare payload sidesteps the HTTP 400.
// Both stream modes are exercised because NVIDIA's gateway treats reasoning
// models differently per stream flag.
async function attemptCompletion(client: OpenAI, model: string, stream: boolean): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'user', content: 'Reply with exactly: OK' },
  ];

  let startedAt = Date.now();
  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      ...(stream ? { stream: true } : { stream: false }),
    });

    if (stream) {
      let out = '';
      for await (const chunk of completion) {
        out += chunk.choices?.[0]?.delta?.content ?? '';
      }
      return `OK (${Date.now() - startedAt}ms) ${JSON.stringify(out.slice(0, 80))}`;
    }

    const out = 'choices' in completion
      ? completion.choices?.[0]?.message?.content ?? ''
      : '';
    return `OK (${Date.now() - startedAt}ms) ${JSON.stringify(out.slice(0, 80))}`;
  } catch (err) {
    startedAt = Date.now() - startedAt;
    return `FAIL (${startedAt}ms) ${fmtError(err)}`;
  }
}

// --- runner ------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('=== NVIDIA AI Endpoints probe ===');
  let openaiVer = 'unknown';
  try {
    const pkgRaw = await import('fs').then(fs => fs.readFileSync('node_modules/openai/package.json', 'utf8'));
    openaiVer = JSON.parse(pkgRaw).version;
  } catch { /* version stays 'unknown' */ }
  console.log(`openai pkg: ${openaiVer}`);
  console.log(`base url : ${BASE_URL}`);
  console.log('');

  for (const ep of ENDPOINTS) {
    if (!ep.key) {
      console.log(`[${ep.label}] ${ep.indexName} is MISSING in .env — skipping`);
      continue;
    }

    const client = new OpenAI({
      apiKey: ep.key,
      baseURL: BASE_URL,
      timeout: TIMEOUT_MS,
      maxRetries: 0,
    });

    console.log(`== ${ep.label} (${ep.indexName}) ==`);

    for (const model of MODELS) {
      for (const stream of [true, false]) {
        const result = await attemptCompletion(client, model, stream);
        console.log(`   ${model}  stream=${stream}  →  ${result}`);
      }
    }
    console.log('');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Probe crashed:', fmtError(err));
  process.exit(1);
});