-- Тимчасове сховище фото з альбомів (для «Зібрати в PDF»); записи живуть годину.
CREATE TABLE IF NOT EXISTS album_items (
  group_id   TEXT    NOT NULL,  -- media_group_id альбому в Telegram
  chat_id    INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  file_id    TEXT    NOT NULL,
  is_doc     INTEGER NOT NULL,  -- 1 — фото надіслане файлом
  size       INTEGER NOT NULL,
  name       TEXT,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (group_id, message_id)
);
CREATE INDEX IF NOT EXISTS album_items_added ON album_items(added_at);
