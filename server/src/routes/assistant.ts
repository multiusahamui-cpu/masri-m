import { Router } from 'express';
import { z } from 'zod';
import { clientIp, HttpError, parseBody } from '../lib/http.js';
import { getConfig } from '../lib/config.js';
import { assertWithinLimits, assistantClient, chat, usageReport } from '../lib/assistant.js';

/** Asisten Virtual publik (website). */
export const assistantRouter = Router();

async function isEnabled(country: string) {
  const on = await getConfig<boolean>('assistant.enabled', country).catch(() => false);
  return on !== false && !!assistantClient();
}

assistantRouter.get('/assistant/status', async (req, res) => {
  const country = z.string().length(2).toUpperCase().catch('ID').parse(req.query.country ?? 'ID');
  const [enabled, whatsapp] = await Promise.all([isEnabled(country), getConfig<string>('general.support_whatsapp', country).catch(() => null)]);
  res.json({ enabled, whatsapp });
});

assistantRouter.post('/assistant/chat', async (req, res) => {
  const b = parseBody(z.object({
    country: z.string().length(2).toUpperCase().default('ID'),
    lang: z.enum(['id', 'ms', 'en']).default('id'),
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).min(1).max(40),
  }), req.body);
  if (!(await isEnabled(b.country))) throw new HttpError(503, 'Asisten Virtual sedang tidak aktif. Silakan hubungi WhatsApp CS kami.');
  const ip = clientIp(req) || 'unknown';
  await assertWithinLimits(ip);
  res.json(await chat(b.messages, { country: b.country, lang: b.lang, ip }));
});

/** Super Admin: status konfigurasi & pemakaian token. */
export const adminAssistantRouter = Router();
adminAssistantRouter.get('/assistant/usage', async (req, res) => {
  const days = z.coerce.number().int().min(1).max(365).catch(30).parse(req.query.days ?? 30);
  res.json(await usageReport(days));
});
