// Тимчасове сховище фото з альбомів: Telegram надсилає фото альбому окремими повідомленнями, а PDF треба
// зібрати з усіх. Зберігаються лише службові ідентифікатори файлів Telegram і лише годину.

const KEEP = 3600; // с

const now = () => Math.floor(Date.now() / 1000);

// D1 на Cloudflare (таблиця з migrations/0001_albums.sql).
export function d1Albums(DB) {
  return {
    add: (it) => DB.prepare(
      `INSERT OR REPLACE INTO album_items (group_id, chat_id, message_id, file_id, is_doc, size, name, added_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
      .bind(it.group_id, it.chat_id, it.message_id, it.file_id, it.is_doc, it.size, it.name, now()).run(),
    list: async (groupId) => (await DB.prepare(
      `SELECT * FROM album_items WHERE group_id = ?1 ORDER BY message_id`).bind(groupId).all()).results,
    cleanup: () => DB.prepare(`DELETE FROM album_items WHERE added_at < ?1`).bind(now() - KEEP).run(),
  };
}

// У пам'яті — для тестів.
export function memoryAlbums() {
  const items = [];
  return {
    items,
    add: async (it) => {
      const i = items.findIndex((x) => x.group_id === it.group_id && x.message_id === it.message_id);
      if (i >= 0) items.splice(i, 1);
      items.push({ ...it, added_at: now() });
    },
    list: async (groupId) => items.filter((x) => x.group_id === groupId).sort((a, b) => a.message_id - b.message_id),
    cleanup: async () => {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].added_at < now() - KEEP) items.splice(i, 1);
    },
  };
}
