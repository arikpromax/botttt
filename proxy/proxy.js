// Адреса Mini App у BotFather — msgsaver.msgsaver.workers.dev (там увімкнено Same-Origin Restriction).
// Сам застосунок (гра Ara Farm, «Що вміє бот», політика) і його API тепер живуть у воркері araconverter,
// тож цей воркер лише пересилає туди кожен запит, не змінюючи адреси.
export default {
  fetch: (request, env) => env.APP.fetch(request),
};
