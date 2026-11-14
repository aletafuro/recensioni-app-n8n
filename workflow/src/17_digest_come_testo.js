// DIGEST COME TESTO (riserva)
// Si arriva qui solo se il nodo Telegram non e' riuscito a mandare il file digest.md.
// Il digest arriva comunque, spezzato ai paragrafi (limite di Telegram: 4096 caratteri per messaggio).
const helpers = this.helpers;
const token = $env.TELEGRAM_BOT_TOKEN, chat = $env.TELEGRAM_CHAT_ID;
let digest = '';
try { digest = $('Usa digest di riserva').first().json.digest; } catch (e) { digest = $('Verifica digest').first().json.digest; }
const SEP = String.fromCharCode(10, 10);
const pezzi = [];
let corrente = '';
for (const par of digest.split(SEP)) {
  if ((corrente + SEP + par).length > 3800 && corrente) { pezzi.push(corrente); corrente = par; } else corrente = corrente ? corrente + SEP + par : par;
}
if (corrente) pezzi.push(corrente);
let inviati = 0;
for (const [i, t] of pezzi.entries()) {
  const r = await helpers.httpRequest({ method: 'POST', url: `https://api.telegram.org/bot${token}/sendMessage`, body: { chat_id: chat, text: `Digest (${i + 1}/${pezzi.length})` + SEP + t, disable_web_page_preview: true }, json: true, timeout: 30000 });
  if (r.ok) inviati++;
}
return [{ json: { digest_come_testo: true, messaggi: pezzi.length, inviati } }];
