CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('customer', 'staff', 'admin')));
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  created_at TEXT NOT NULL
);
